package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/Akapi895/raptix/backend/internal/api"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/filesystem"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/postgres"
)

// App is the composition root: wires adapters and manages the HTTP server and storage.
type App struct {
	cfg      *Config
	log      *slog.Logger
	pool     *postgres.Pool
	fs       *filesystem.Store
	srv      *http.Server
	requests *api.RequestTracker

	// baseCtx/baseCancel root every request context; on shutdown timeout
	// baseCancel cancels in-flight requests before storage is closed.
	baseCtx    context.Context
	baseCancel context.CancelFunc

	closeOnce sync.Once
}

// New builds an App, opening the PostgreSQL pool, filesystem store and HTTP server.
func New(cfg *Config, log *slog.Logger) (*App, error) {
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

	baseCtx, baseCancel := context.WithCancel(context.Background())

	requests := api.NewRequestTracker()
	handler := api.Router(pool, log, requests)
	srv := &http.Server{
		Addr:              cfg.Server.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return baseCtx },
	}

	return &App{
		cfg: cfg, log: log, pool: pool, fs: fs, srv: srv, requests: requests,
		baseCtx: baseCtx, baseCancel: baseCancel,
	}, nil
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
