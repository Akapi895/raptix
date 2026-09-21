// Package postgres provides the shared pgxpool adapter and transaction primitive.
package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolConfig is the minimum connection configuration for Phase 1.
type PoolConfig struct {
	URL      string
	MaxConns int32
	// ConnectTimeout bounds pool creation and per-connection connects.
	ConnectTimeout time.Duration
}

// Pool wraps pgxpool with a health check.
type Pool struct {
	pool *pgxpool.Pool
	cfg  PoolConfig
}

// Open creates a PostgreSQL pool. It does not fail if the DB is not yet ready;
// Health always pings to report the real state.
func Open(ctx context.Context, cfg PoolConfig) (*Pool, error) {
	if cfg.ConnectTimeout <= 0 {
		return nil, fmt.Errorf("connect_timeout must be positive, got %s", cfg.ConnectTimeout)
	}
	cp, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("parse pgxpool config: %w", err)
	}
	cp.MaxConns = int32(cfg.MaxConns)
	if cp.MaxConns <= 0 {
		cp.MaxConns = 10
	}
	cp.ConnConfig.ConnectTimeout = cfg.ConnectTimeout
	connectCtx, cancel := context.WithTimeout(ctx, cfg.ConnectTimeout)
	defer cancel()

	p, err := pgxpool.NewWithConfig(connectCtx, cp)
	if err != nil {
		return nil, fmt.Errorf("init pgxpool: %w", err)
	}
	return &Pool{pool: p, cfg: cfg}, nil
}

// Ping checks the actual DB connection.
func (p *Pool) Ping(ctx context.Context) error {
	return p.pool.Ping(ctx)
}

// Health returns nil if the DB is ready, otherwise an error.
func (p *Pool) Health(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, p.cfg.ConnectTimeout)
	defer cancel()
	if err := p.pool.Ping(ctx); err != nil {
		return fmt.Errorf("database ping: %w", err)
	}
	return nil
}

// TxFunc runs fn inside a transaction with automatic commit/rollback.
// The callback receives the open transaction so its queries join it.
func (p *Pool) TxFunc(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			// Roll back even after the request is cancelled, but bound cleanup time.
			rollbackCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), p.cfg.ConnectTimeout)
			defer cancel()
			_ = tx.Rollback(rollbackCtx)
		}
	}()

	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	committed = true
	return nil
}

// Close closes the pool.
func (p *Pool) Close() {
	if p.pool != nil {
		p.pool.Close()
	}
}
