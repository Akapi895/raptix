// Package jobs is the only adapter that knows River. It owns job payload
// versions, worker registration, retry policy and client lifecycle, and calls
// public module services. Business modules never import River types.
package jobs

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"
)

// ReportRenderKind is the stable River job kind for rendering one report. It
// must not be renamed after deployment.
const ReportRenderKind = "report_render"

// ReportRenderVersion is the payload version. A worker only handles versions it
// understands; bumping it is a deliberate migration.
const ReportRenderVersion = 1

// ReportRenderer is the public reporting operation a worker invokes. It renders
// only the immutable stored snapshot and is idempotent under redelivery.
type ReportRenderer interface {
	Render(ctx context.Context, id uuid.UUID, worker string) error
}

// ReportRenderArgs is the versioned River payload. It carries only the report
// request id; the immutable snapshot is read from the reporting module.
type ReportRenderArgs struct {
	Version         int       `json:"version" river:"unique"`
	ReportRequestID uuid.UUID `json:"reportRequestId" river:"unique"`
}

// Kind implements river.JobArgs.
func (ReportRenderArgs) Kind() string { return ReportRenderKind }

// InsertOpts makes enqueue idempotent: a redelivered request for the same report
// cannot create a second active render job.
func (ReportRenderArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{UniqueOpts: river.UniqueOpts{ByArgs: true}}
}

// reportRenderWorker runs the render and maps its retry hint onto River.
type reportRenderWorker struct {
	river.WorkerDefaults[ReportRenderArgs]
	renderer ReportRenderer
	workerID string
	log      *slog.Logger
}

func (w *reportRenderWorker) Work(ctx context.Context, job *river.Job[ReportRenderArgs]) error {
	if job.Args.Version != ReportRenderVersion {
		// An unknown payload version is not retried forever; it is discarded.
		return river.JobCancel(fmt.Errorf("unsupported report render payload version %d", job.Args.Version))
	}
	if w.renderer == nil {
		return fmt.Errorf("report renderer is not configured")
	}
	err := w.renderer.Render(ctx, job.Args.ReportRequestID, w.workerID)
	if err == nil {
		return nil
	}
	if retry, ok := asRetryAfter(err); ok {
		return river.JobSnooze(retry)
	}
	return err
}

// RetryAfterError is a portable retry hint. The reporting module returns a
// value implementing this interface when a lease is held or a transient publish
// failed, so jobs can snooze without importing reporting.
type RetryAfterError interface {
	RetryAfter() time.Duration
}

func asRetryAfter(err error) (time.Duration, bool) {
	for err != nil {
		if hint, ok := err.(RetryAfterError); ok {
			return hint.RetryAfter(), true
		}
		unwrapper, ok := err.(interface{ Unwrap() error })
		if !ok {
			return 0, false
		}
		err = unwrapper.Unwrap()
	}
	return 0, false
}

// Client wraps a River client that both inserts and works report jobs.
type Client struct {
	client   *river.Client[pgx.Tx]
	renderer ReportRenderer
	workerID string
	log      *slog.Logger
}

// Config configures the jobs adapter.
type Config struct {
	MaxWorkers int
}

// New builds the River client and registers workers. It does not start them.
func New(pool *pgxpool.Pool, renderer ReportRenderer, cfg Config, log *slog.Logger) (*Client, error) {
	if pool == nil {
		return nil, fmt.Errorf("jobs pool is required")
	}
	if renderer == nil {
		return nil, fmt.Errorf("jobs renderer is required")
	}
	if log == nil {
		log = slog.Default()
	}
	maxWorkers := cfg.MaxWorkers
	if maxWorkers <= 0 {
		maxWorkers = 4
	}
	workerID := "raptix-report-worker"

	workers := river.NewWorkers()
	river.AddWorker(workers, &reportRenderWorker{renderer: renderer, workerID: workerID, log: log})

	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Workers: workers,
		Queues: map[string]river.QueueConfig{
			river.QueueDefault: {MaxWorkers: maxWorkers},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("create river client: %w", err)
	}
	return &Client{client: client, renderer: renderer, workerID: workerID, log: log}, nil
}

// Start begins working jobs until ctx is cancelled or Stop is called.
func (c *Client) Start(ctx context.Context) error {
	if err := c.client.Start(ctx); err != nil {
		return fmt.Errorf("start river client: %w", err)
	}
	return nil
}

// Stop gracefully stops the worker.
func (c *Client) Stop(ctx context.Context) error {
	return c.client.Stop(ctx)
}

// EnqueueReportRender inserts a render job outside any caller transaction.
func (c *Client) EnqueueReportRender(ctx context.Context, reportID uuid.UUID) error {
	return c.enqueue(ctx, func(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) error {
		_, err := c.client.Insert(ctx, args, opts)
		return err
	}, reportID)
}

// EnqueueReportRenderTx inserts the render job on the caller's transaction so a
// report request, its snapshot and its job commit atomically.
func (c *Client) EnqueueReportRenderTx(ctx context.Context, tx pgx.Tx, reportID uuid.UUID) error {
	return c.enqueue(ctx, func(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) error {
		_, err := c.client.InsertTx(ctx, tx, args, opts)
		return err
	}, reportID)
}

func (c *Client) enqueue(ctx context.Context, insert func(context.Context, river.JobArgs, *river.InsertOpts) error, reportID uuid.UUID) error {
	if reportID == uuid.Nil {
		return fmt.Errorf("report request id is required")
	}
	args := ReportRenderArgs{Version: ReportRenderVersion, ReportRequestID: reportID}
	if err := insert(ctx, args, nil); err != nil {
		return fmt.Errorf("insert report render job: %w", err)
	}
	return nil
}

// Migrate applies River's own schema migrations. It is a release step run by
// cmd/migrate, never by the server on startup.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	driver := riverpgxv5.New(pool)
	migrator, err := rivermigrate.New(driver, nil)
	if err != nil {
		return fmt.Errorf("init river migrator: %w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("river migrate up: %w", err)
	}
	return nil
}

// MigrateDown reverts the most recent River migration step.
func MigrateDown(ctx context.Context, pool *pgxpool.Pool) error {
	driver := riverpgxv5.New(pool)
	migrator, err := rivermigrate.New(driver, nil)
	if err != nil {
		return fmt.Errorf("init river migrator: %w", err)
	}
	if _, err := migrator.Migrate(ctx, rivermigrate.DirectionDown, &rivermigrate.MigrateOpts{MaxSteps: 1}); err != nil {
		return fmt.Errorf("river migrate down: %w", err)
	}
	return nil
}

// Status reports whether every River migration is applied.
func Status(ctx context.Context, pool *pgxpool.Pool) (bool, []string, error) {
	driver := riverpgxv5.New(pool)
	migrator, err := rivermigrate.New(driver, nil)
	if err != nil {
		return false, nil, fmt.Errorf("init river migrator: %w", err)
	}
	res, err := migrator.Validate(ctx, &rivermigrate.ValidateOpts{})
	if err != nil {
		return false, nil, fmt.Errorf("river validate: %w", err)
	}
	return res.OK, res.Messages, nil
}
