package app

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/Akapi895/raptix/backend/internal/content"
	"github.com/Akapi895/raptix/backend/internal/engine/agents"
	"github.com/Akapi895/raptix/backend/internal/engine/contextbuild"
	"github.com/Akapi895/raptix/backend/internal/engine/llm"
	"github.com/Akapi895/raptix/backend/internal/engine/runs"
	"github.com/Akapi895/raptix/backend/internal/execution/artifact"
	"github.com/Akapi895/raptix/backend/internal/execution/cancel"
	"github.com/Akapi895/raptix/backend/internal/execution/invocation"
	"github.com/Akapi895/raptix/backend/internal/execution/sandbox"
	"github.com/Akapi895/raptix/backend/internal/execution/sandbox/container"
	"github.com/Akapi895/raptix/backend/internal/execution/sandbox/local"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/filesystem"
	"github.com/Akapi895/raptix/backend/internal/infrastructure/database/postgres"
	"github.com/Akapi895/raptix/backend/internal/platform/audit"
	"github.com/Akapi895/raptix/backend/internal/platform/governance"
	"github.com/Akapi895/raptix/backend/internal/platform/projects"
	"github.com/Akapi895/raptix/backend/internal/tools/builtin"
	"github.com/Akapi895/raptix/backend/internal/tools/builtin/command"
	"github.com/Akapi895/raptix/backend/internal/tools/output"
	"github.com/Akapi895/raptix/backend/internal/tools/registry"
	"github.com/Akapi895/raptix/backend/internal/workspace/assessment"
	"github.com/Akapi895/raptix/backend/internal/workspace/evidence"
	"github.com/Akapi895/raptix/backend/internal/workspace/findings"
	"github.com/Akapi895/raptix/backend/internal/workspace/reporting"
	"github.com/Akapi895/raptix/backend/internal/workspace/verifier"
)

// Services exposes the business services wired through the composition root.
// Handlers and entrypoints use these; they never import a module store.
type Services struct {
	Projects   *projects.Service
	Governance *governance.Service
	Audit      *audit.Service
	Runs       *runs.Service
	Evidence   *evidence.Service
	Assessment *assessment.Service
	Findings   *findings.Service
	Execution  *invocation.Service
	Agents     *agents.Service
	Verifier   *verifier.Service
	Reporting  *reporting.Service

	cancel              *cancel.Service
	reconcileStaleAfter time.Duration
	reportTemplates     *reportTemplates
	reportJobs          ReportEnqueuer
	pool                *postgres.Pool
	reportInputs        *reportInputs
	reportOutput        *reportOutput
	reportRenderConfig  reporting.RenderConfig
}

// SetReportEnqueuer installs the durable queue adapter used to render reports.
// It is called by the composition root after services are wired; reporting stays
// queue-agnostic.
func (s *Services) SetReportEnqueuer(enqueuer ReportEnqueuer) {
	s.reportJobs = enqueuer
}

// InvokeCapability is the use case entrypoint for dispatching a capability
// through execution. Tests and entrypoints call it instead of reaching into the
// execution service directly; governance, scope, run state and budget are
// enforced inside the execution service at dispatch time.
func (s *Services) InvokeCapability(ctx context.Context, p invocation.InvokeParams) (invocation.Invocation, *output.Result, error) {
	return s.Execution.Invoke(ctx, p)
}

// wireServices builds each module Postgres-backed repository over the shared
// pool, binds capability implementations into the registry, and returns the
// composed services. The pool is lazy, so this succeeds before the database is
// reachable; running a query still requires connectivity.
//
// Cross-module wiring follows the ownership rules: governance learns about
// scope validity through the projects service contract (never by querying the
// projects/scopes tables), evidence persists bytes through the filesystem store
// rather than trusting caller-supplied checksums, and execution receives its
// ports as interfaces (governance, projects, runs, audit) so it never imports a
// concrete store. Only app constructs the concrete sandbox adapter.
func wireServices(pool *postgres.Pool, fs *filesystem.Store, reg *registry.Registry, loader *content.Loader, model llm.Model, cfg *Config, log *slog.Logger) (*Services, error) {
	dbtx := pool.DB()
	projectSvc := projects.NewService(projects.NewPostgres(dbtx))
	evidenceSvc := evidence.NewService(evidence.NewPostgres(dbtx), fs)
	runSvc := runs.NewService(runs.NewPostgres(dbtx))
	auditSvc := audit.NewService(audit.NewPostgres(dbtx))

	runner, err := newSandboxRunner(cfg.Sandbox, log)
	if err != nil {
		return nil, err
	}

	svc := &Services{
		Projects:   projectSvc,
		Governance: governance.NewService(governance.NewPostgres(dbtx), projectSvc),
		Audit:      auditSvc,
		Runs:       runSvc,
		Evidence:   evidenceSvc,
		Assessment: assessment.NewService(assessment.NewPostgres(dbtx)),
		Findings:   findings.NewService(findings.NewPostgres(dbtx)),
	}

	if loader != nil {
		bindCapabilities(reg, loader, svc, runner, cfg, log)
	}

	svc.Execution = invocation.NewService(
		invocation.NewPostgres(dbtx),
		invocation.Config{
			DefaultTimeout:       cfg.Execution.DefaultTimeout,
			MaxOutputBytes:       cfg.Execution.MaxOutputBytes,
			MaxInvocationsPerRun: cfg.Execution.MaxInvocationsPerRun,
		},
		svc.Governance, // GrantChecker
		svc.Projects,   // ScopeReader
		svc.Runs,       // RunStateReader
		svc.Audit,      // AuditRecorder
		reg,            // resolver
		log,
	)

	// Phase 6: cancel/reconcile policy over executions. It shares the
	// invocation Postgres repository as its Store; cascade across runs/agents
	// is orchestrated by the app-level CancelRun use case.
	svc.cancel = cancel.NewService(invocation.NewPostgres(dbtx), log)
	svc.reconcileStaleAfter = cfg.Execution.ReconcileStaleAfter

	// Phase 5: the agent loop and verifier. Both dispatch through the same
	// execution service (svc.InvokeCapability), so there is no second execution
	// path. The agent loop is inert when no model is configured.
	var source contextbuild.PromptSource
	if loader != nil {
		source = loader
	}
	ctxBuilder := contextbuild.NewBuilder(source, contextbuild.Budget{MaxTokens: cfg.Agent.MaxContextTokens})
	agentModel := cfg.Agent.Model
	if agentModel == "" {
		agentModel = cfg.LLM.Model
	}
	svc.Agents = agents.NewService(
		agents.NewPostgres(dbtx),
		model,
		ctxBuilder,
		svc,            // ToolExecutor (Services.InvokeCapability)
		svc.Runs,       // RunState
		svc.Governance, // GrantChecker
		reg,            // CapabilityResolver
		agents.Config{
			MaxSteps:       cfg.Agent.MaxSteps,
			DefaultTimeout: cfg.Agent.DefaultTimeout,
			Model:          agentModel,
		},
		log,
	)
	svc.Verifier = verifier.NewService(svc, svc.Findings, svc.Findings, "verifier")

	// Phase 8: reporting owns the immutable report snapshot and publication
	// lifecycle. Rendering dependencies are injected here; the queue adapter is
	// installed later by SetReportEnqueuer so reporting never imports jobs.
	reportOutputAdapter := &reportOutput{services: svc}
	templateAdapter := &reportTemplates{loader: loader}
	reportInputAdapter := &reportInputs{services: svc}
	renderConfig := reporting.RenderConfig{
		Templates:     templateAdapter,
		Output:        reportOutputAdapter,
		LeaseDuration: cfg.Reporting.RenderLease,
	}
	svc.Reporting = reporting.NewService(reporting.NewPostgres(dbtx), reportInputAdapter, reportOutputAdapter, renderConfig)
	svc.reportTemplates = templateAdapter
	svc.reportInputs = reportInputAdapter
	svc.reportOutput = reportOutputAdapter
	svc.reportRenderConfig = renderConfig
	svc.pool = pool
	return svc, nil
}

// bindCapabilities attaches Go implementations to manifest-declared tools.
// Binding only makes a capability runnable; it never grants execution rights,
// which execution checks against governance at dispatch. A tool whose manifest
// is missing stays declared-only and unavailable rather than failing startup.
func bindCapabilities(reg *registry.Registry, loader *content.Loader, svc *Services, runner sandbox.Runner, cfg *Config, log *slog.Logger) {
	writer := artifact.NewWriter(svc.Evidence)

	probe := builtin.NewHTTPProbe(svc.Evidence, cfg.Execution.DefaultTimeout, cfg.Execution.MaxOutputBytes)
	if err := reg.RegisterFromManifest(loader, "http_probe", probe); err != nil {
		log.Warn("bind builtin capability", "tool", "http_probe", "error", err)
	} else {
		log.Info("bound builtin capability", "tool", "http_probe")
	}

	nmap := command.New("nmap", command.Options{
		Base:         "nmap",
		BaseArgs:     []string{"-sT", "-sV"},
		AllowedFlags: []string{"-sV", "-Pn", "-T4", "-n"},
		MaxOutput:    cfg.Sandbox.MaxOutputBytes,
	}, runner, writer)
	if err := reg.RegisterFromManifest(loader, "nmap", nmap); err != nil {
		log.Warn("bind command capability", "tool", "nmap", "error", err)
	} else {
		log.Info("bound command capability", "tool", "nmap")
	}
}

// newSandboxRunner selects the process environment for command capabilities.
func newSandboxRunner(cfg SandboxConfig, log *slog.Logger) (sandbox.Runner, error) {
	switch cfg.Mode {
	case "", "local":
		return local.New(cfg.MaxOutputBytes, log), nil
	case "container":
		return container.New(container.Config{
			Image:          cfg.Image,
			Network:        cfg.Network,
			MaxOutputBytes: cfg.MaxOutputBytes,
		}, log)
	default:
		return nil, fmt.Errorf("unsupported sandbox mode %q", cfg.Mode)
	}
}
