package postgres

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// testPool only runs when RAP_TEST_DATABASE_URL is set (opt-in) to avoid the dev DB.
// With a DSN set, an unreachable DB fails rather than skips so misconfiguration cannot
// produce a false green run.
func testPool(t *testing.T) *Pool {
	t.Helper()
	dsn := os.Getenv("RAP_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("integration test: set RAP_TEST_DATABASE_URL to a dedicated test database to run")
	}
	p, err := Open(context.Background(), PoolConfig{
		URL:            dsn,
		MaxConns:       2,
		ConnectTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := p.Health(ctx); err != nil {
		p.Close()
		t.Fatalf("test database not reachable (RAP_TEST_DATABASE_URL=%q): %v", dsn, err)
	}
	t.Cleanup(p.Close)
	return p
}

// newTestTable creates a per-test random table to avoid collisions across processes
// and cleans up only the resource it created.
func newTestTable(t *testing.T, ctx context.Context, p *Pool) string {
	t.Helper()
	b := make([]byte, 4)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	name := fmt.Sprintf("_tx_test_%s", hex.EncodeToString(b))
	mustExec(t, ctx, p, "CREATE TABLE "+name+" (id int PRIMARY KEY, v text)")
	t.Cleanup(func() {
		_, _ = p.pool.Exec(context.Background(), "DROP TABLE IF EXISTS "+name)
	})
	return name
}

func TestTxFuncCommits(t *testing.T) {
	p := testPool(t)
	ctx := context.Background()
	table := newTestTable(t, ctx, p)

	err := p.TxFunc(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO "+table+"(id, v) VALUES ($1, $2)", 1, "committed"); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		t.Fatalf("TxFunc commit: %v", err)
	}

	var v string
	if err := p.pool.QueryRow(ctx, "SELECT v FROM "+table+" WHERE id=1").Scan(&v); err != nil {
		t.Fatalf("read committed row: %v", err)
	}
	if v != "committed" {
		t.Errorf("row value = %q, want committed", v)
	}
}

func TestTxFuncRollsBackOnError(t *testing.T) {
	p := testPool(t)
	ctx := context.Background()
	table := newTestTable(t, ctx, p)

	sentinel := errors.New("boom")
	err := p.TxFunc(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO "+table+"(id, v) VALUES ($1, $2)", 1, "x"); err != nil {
			return err
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("TxFunc err = %v, want sentinel", err)
	}

	var n int
	if err := p.pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("expected 0 rows after rollback, got %d", n)
	}
}

func TestTxFuncRollsBackAfterRequestCancellation(t *testing.T) {
	p := testPool(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	table := newTestTable(t, context.Background(), p)

	sentinel := errors.New("cancelled callback")
	err := p.TxFunc(ctx, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "INSERT INTO "+table+"(id, v) VALUES ($1, $2)", 1, "x"); err != nil {
			return err
		}
		cancel()
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("TxFunc err = %v, want sentinel", err)
	}

	var n int
	if err := p.pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Errorf("expected 0 rows after rollback, got %d", n)
	}
}

func mustExec(t *testing.T, ctx context.Context, p *Pool, sql string, args ...any) {
	t.Helper()
	_, err := p.pool.Exec(ctx, sql, args...)
	if err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}
