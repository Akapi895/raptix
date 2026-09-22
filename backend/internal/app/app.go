package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/Akapi895/raptix/backend/internal/api"
	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
	einoadapter "github.com/Akapi895/raptix/backend/internal/engine/llm/adapters/eino"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/filesystem"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/postgres"
	"github.com/Akapi895/raptix/backend/internal/tools/registry"
)

// App is the composition root: wires adapters and manages the HTTP server and storage.
type App struct {
	cfg      *Config
	log      *slog.Logger
	pool     *postgres.Pool
	fs       *filesystem.Store
	content  *content.Loader
	allTools *registry.Registry
	model    llm.Model
	srv      *http.Server
	requests *api.RequestTracker
	services *Services

	// baseCtx/baseCancel root every request context; on shutdown timeout
	// baseCancel cancels in-flight requests before storage is closed.
	baseCtx    context.Context
	baseCancel context.CancelFunc

	closeOnce sync.Once
}

// New builds an App, opening the PostgreSQL pool, filesystem store and HTTP server.
func New(cfg *Config, log *slog.Logger) (*App, error) {
	if log == nil {
		log = slog.Default()
	}
	connectCtx, cancel := context.WithTimeout(context.Background(), cfg.Database.ConnectTimeout)
	defer cancel()

	pool, err := postgres.Open(connectCtx, postgres.PoolConfig{
		URL:            cfg.Database.URL,
		MaxConns:       cfg.Database.MaxConns,
		ConnectTimeout: cfg.Database.ConnectTimeout,
	})
	if err != nil {
		return nil, fmt.Errorf("open database pool: %w", err)
	}

	fs, err := filesystem.NewStore(cfg.Artifact.Root)
	if err != nil {
		pool.Close()
		return nil, fmt.Errorf("open artifact store: %w", err)
	}

	contentLoader, err := content.NewLoader(cfg.Content.Root, cfg.Content.SchemaRoot)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			log.Info("content catalog disabled; root not present", "root", cfg.Content.Root)
		} else {
			_ = fs.Close()
			pool.Close()
			return nil, fmt.Errorf("open content loader: %w", err)
		}
	}

	// The tool registry maps manifest-declared capabilities to implementations.
	// Registration only makes a tool discoverable; it grants no execution right.
	allTools := registry.New()
	if contentLoader != nil {
		if err := registerManifestTools(allTools, contentLoader, log); err != nil {
			_ = fs.Close()
			pool.Close()
			return nil, fmt.Errorf("register manifest tools: %w", err)
		}
	}

	// The model adapter exposes the business llm.Model contract. It is optional
	// for Phase 1-3 (agent loop is Phase 5): without an API key we skip wiring so
	// startup still succeeds; with a key we connect the provider.
	var model llm.Model
	if cfg.LLM.APIKey != "" {
		model, err = einoadapter.New(einoadapter.Config{
			BaseURL:      cfg.LLM.BaseURL,
			APIKey:       cfg.LLM.APIKey,
			Timeout:      cfg.LLM.Timeout,
			DefaultModel: cfg.LLM.Model,
		})
		if err != nil {
			_ = fs.Close()
			pool.Close()
			return nil, fmt.Errorf("initialize LLM adapter: %w", err)
		} else {
			log.Info("llm model configured", "model", cfg.LLM.Model, "base_url", cfg.LLM.BaseURL)
		}
	} else {
		log.Warn("llm API key not set; model calls disabled")
	}

	baseCtx, baseCancel := context.WithCancel(context.Background())

	services, err := wireServices(pool, fs, allTools, contentLoader, model, cfg, log)
	if err != nil {
		baseCancel()
		_ = fs.Close()
		pool.Close()
		return nil, fmt.Errorf("wire services: %w", err)
	}

	requests := api.NewRequestTracker()
	handler := api.Router(pool, log, requests)
	srv := &http.Server{
		Addr:              cfg.Server.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
	}

	return &App{
		cfg: cfg, log: log, pool: pool, fs: fs, content: contentLoader,
		allTools: allTools, model: model,
		srv: srv, requests: requests,
		services: services,
		baseCtx:  baseCtx, baseCancel: baseCancel,
	}, nil
}

// registerManifestTools declares tool capabilities found in the content root.
// Tools with a registered Go implementation are wired here; the rest are
// declared-only (compatible but not yet runnable) until execution dispatches.
func registerManifestTools(reg *registry.Registry, l *content.Loader, log *slog.Logger) error {
	names, err := l.List(content.KindTool)
	if err != nil {
		return fmt.Errorf("list tools: %w", err)
	}
	for _, n := range names {
		if err := reg.RegisterFromManifest(l, n, nil); err != nil {
			log.Warn("register tool manifest", "tool", n, "error", err)
			continue
		}
		log.Info("registered tool from manifest", "tool", n)
	}
	return nil
}

// Run listens on cfg.Server.Addr and coordinates shutdown. For production use.
func (a *App) Run(ctx context.Context) error {
	ln, err := net.Listen("tcp", a.cfg.Server.Addr)
	if err != nil {
		a.closeStorage()
		return fmt.Errorf("listen %s: %w", a.cfg.Server.Addr, err)
	}
	return a.serve(ctx, ln)
}

// Serve runs the HTTP server on an existing listener (used by tests with port 0).
func (a *App) Serve(ctx context.Context, ln net.Listener) error {
	return a.serve(ctx, ln)
}

// serve is the lifecycle core: on ctx cancel or listener error it stops accepting
// requests, drains in-flight ones within ShutdownTimeout, then cancels them on a
// timeout. Storage is closed only after draining finishes. Returns a timeout error
// when shutdown overruns, a server error when Serve fails, or nil on a clean stop.
func (a *App) serve(ctx context.Context, ln net.Listener) error {
	shutdownRequest := make(chan struct{})
	done := make(chan shutdownResult, 1)

	go func() {
		select {
		case <-ctx.Done():
		case <-shutdownRequest:
		}

		drained := a.requests.BeginDrain()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), a.cfg.Server.ShutdownTimeout)
		defer cancel()
		if err := a.srv.Shutdown(shutdownCtx); err != nil {
			a.baseCancel()
			_ = a.srv.Close()

			forceDrainCtx, forceCancel := context.WithTimeout(context.Background(), a.cfg.Server.ShutdownTimeout)
			defer forceCancel()
			select {
			case <-drained:
				done <- shutdownResult{err: fmt.Errorf("http shutdown timeout: %w", err), storageSafe: true}
			case <-forceDrainCtx.Done():
				done <- shutdownResult{
					err:         fmt.Errorf("http shutdown timeout: %w; active requests did not stop", err),
					storageSafe: false,
				}
			}
			return
		}
		a.log.Info("http server stopped")
		done <- shutdownResult{storageSafe: true}
	}()

	a.log.Info("http server listening", "addr", ln.Addr().String())
	serveErr := a.srv.Serve(ln)

	if serveErr == nil || errors.Is(serveErr, http.ErrServerClosed) {
		result := <-done
		if result.storageSafe {
			a.closeStorage()
		}
		return result.err
	}

	// Non-shutdown Serve error: trigger internal shutdown, await cleanup, close storage.
	select {
	case <-shutdownRequest:
	default:
		close(shutdownRequest)
	}
	result := <-done
	if result.storageSafe {
		a.closeStorage()
	}
	return fmt.Errorf("http server: %w", serveErr)
}

type shutdownResult struct {
	err         error
	storageSafe bool
}

// closeStorage closes storage once. Only call after requests have stopped.
func (a *App) closeStorage() {
	a.closeOnce.Do(func() {
		if a.pool != nil {
			a.pool.Close()
		}
		if a.fs != nil {
			_ = a.fs.Close()
		}
	})
}
