package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// schema is applied on every start; every statement is idempotent.
const schema = `
CREATE TABLE IF NOT EXISTS stock (
  product_id  UUID PRIMARY KEY,
  quantity    INTEGER NOT NULL CHECK (quantity >= 0),   -- the database itself refuses negative stock
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_quantity_idx ON stock (quantity);

-- What each reservation (one per order) holds, so it can be released exactly once.
CREATE TABLE IF NOT EXISTS reservations (
  id           UUID NOT NULL,
  product_id   UUID NOT NULL,
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at  TIMESTAMPTZ,
  PRIMARY KEY (id, product_id)
);

-- Reservations that were released (or released before they ever happened, after a
-- caller timeout). A late ReserveStock with one of these ids is refused.
CREATE TABLE IF NOT EXISTS closed_reservations (
  id          UUID PRIMARY KEY,
  closed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

type Level struct {
	ProductID string
	Quantity  int32
}

type Item struct {
	ProductID string
	Quantity  int32
}

var (
	ErrReservationClosed = errors.New("reservation was already released")
	ErrBelowZero         = errors.New("stock cannot go below zero")
)

type NotFoundError struct{ ProductID string }

func (e *NotFoundError) Error() string { return fmt.Sprintf("product %s has no stock record", e.ProductID) }

type InsufficientError struct {
	ProductID            string
	Requested, Available int32
}

func (e *InsufficientError) Error() string {
	return fmt.Sprintf("insufficient stock for product %s: requested %d, available %d", e.ProductID, e.Requested, e.Available)
}

type Store struct{ pool *pgxpool.Pool }

// OpenStore creates inventory_db if needed (existing Docker volumes predate it),
// connects, and applies the schema.
func OpenStore(ctx context.Context, url string, log *slog.Logger) (*Store, error) {
	if err := ensureDatabase(ctx, url, log); err != nil {
		return nil, err
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if _, err := pool.Exec(ctx, schema); err != nil {
		pool.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func ensureDatabase(ctx context.Context, url string, log *slog.Logger) error {
	cfg, err := pgx.ParseConfig(url)
	if err != nil {
		return err
	}
	name := cfg.Database
	cfg.Database = "postgres"

	var conn *pgx.Conn
	for attempt := 1; ; attempt++ {
		if conn, err = pgx.ConnectConfig(ctx, cfg); err == nil {
			break
		}
		if attempt == 10 {
			return fmt.Errorf("connect to postgres: %w", err)
		}
		log.Warn("waiting for postgres", "attempt", attempt, "err", err)
		time.Sleep(2 * time.Second)
	}
	defer conn.Close(ctx)

	var exists bool
	if err := conn.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)", name).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		if _, err := conn.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{name}.Sanitize()); err != nil {
			return fmt.Errorf("create database %s: %w", name, err)
		}
		log.Info("created database", "name", name)
	}
	return nil
}

func (s *Store) Check(ctx context.Context, ids []string) (map[string]int32, error) {
	rows, err := s.pool.Query(ctx, "SELECT product_id::text, quantity FROM stock WHERE product_id = ANY($1::uuid[])", ids)
	if err != nil {
		return nil, err
	}
	levels, err := collectLevels(rows)
	if err != nil {
		return nil, err
	}
	found := make(map[string]int32, len(levels))
	for _, l := range levels {
		found[l.ProductID] = l.Quantity
	}
	return found, nil
}

// Reserve takes every item in one transaction. Each UPDATE only succeeds while
// enough stock is left, so two orders racing for the last unit can't both win:
// Postgres locks the row, and the second UPDATE re-checks "quantity >= n" after
// the first commits. Items are sorted by product id so two orders never lock
// the same rows in opposite order (no deadlocks).
func (s *Store) Reserve(ctx context.Context, reservationID string, items []Item) ([]Level, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// Serialises Reserve and Release for the same reservation id.
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", reservationID); err != nil {
		return nil, err
	}

	var closed bool
	if err := tx.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM closed_reservations WHERE id = $1)", reservationID).Scan(&closed); err != nil {
		return nil, err
	}
	if closed {
		return nil, ErrReservationClosed
	}

	// Retry of a reservation that already succeeded: return it as it is.
	rows, err := tx.Query(ctx, `SELECT r.product_id::text, s.quantity FROM reservations r
		JOIN stock s ON s.product_id = r.product_id WHERE r.id = $1 ORDER BY r.product_id`, reservationID)
	if err != nil {
		return nil, err
	}
	existing, err := collectLevels(rows)
	if err != nil {
		return nil, err
	}
	if len(existing) > 0 {
		return existing, tx.Commit(ctx)
	}

	remaining := make([]Level, 0, len(items))
	for _, it := range items {
		var left int32
		err := tx.QueryRow(ctx, `UPDATE stock SET quantity = quantity - $2, updated_at = now()
			WHERE product_id = $1 AND quantity >= $2 RETURNING quantity`, it.ProductID, it.Quantity).Scan(&left)
		if errors.Is(err, pgx.ErrNoRows) {
			var available int32
			if err := tx.QueryRow(ctx, "SELECT quantity FROM stock WHERE product_id = $1", it.ProductID).Scan(&available); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return nil, &NotFoundError{it.ProductID}
				}
				return nil, err
			}
			return nil, &InsufficientError{ProductID: it.ProductID, Requested: it.Quantity, Available: available}
		}
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, "INSERT INTO reservations (id, product_id, quantity) VALUES ($1, $2, $3)",
			reservationID, it.ProductID, it.Quantity); err != nil {
			return nil, err
		}
		remaining = append(remaining, Level{it.ProductID, left})
	}
	return remaining, tx.Commit(ctx)
}

// Release returns a reservation's stock once. Unknown or already-released ids are
// a no-op, and the id is closed so a late ReserveStock with it is refused.
func (s *Store) Release(ctx context.Context, reservationID string) ([]Level, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", reservationID); err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `UPDATE reservations SET released_at = now()
		WHERE id = $1 AND released_at IS NULL RETURNING product_id::text, quantity`, reservationID)
	if err != nil {
		return nil, err
	}
	held, err := collectLevels(rows)
	if err != nil {
		return nil, err
	}
	sortLevels(held)

	restored := make([]Level, 0, len(held))
	for _, h := range held {
		var now int32
		if err := tx.QueryRow(ctx, `UPDATE stock SET quantity = quantity + $2, updated_at = now()
			WHERE product_id = $1 RETURNING quantity`, h.ProductID, h.Quantity).Scan(&now); err != nil {
			return nil, err
		}
		restored = append(restored, Level{h.ProductID, now})
	}
	if _, err := tx.Exec(ctx, "INSERT INTO closed_reservations (id) VALUES ($1) ON CONFLICT DO NOTHING", reservationID); err != nil {
		return nil, err
	}
	return restored, tx.Commit(ctx)
}

func (s *Store) Set(ctx context.Context, productID string, quantity int32) (int32, error) {
	var q int32
	err := s.pool.QueryRow(ctx, `INSERT INTO stock (product_id, quantity) VALUES ($1, $2)
		ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
		RETURNING quantity`, productID, quantity).Scan(&q)
	return q, err
}

func (s *Store) Adjust(ctx context.Context, productID string, delta int32) (int32, error) {
	var q int32
	err := s.pool.QueryRow(ctx, `UPDATE stock SET quantity = quantity + $2, updated_at = now()
		WHERE product_id = $1 AND quantity + $2 >= 0 RETURNING quantity`, productID, delta).Scan(&q)
	if !errors.Is(err, pgx.ErrNoRows) {
		return q, err
	}
	var exists bool
	if err := s.pool.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM stock WHERE product_id = $1)", productID).Scan(&exists); err != nil {
		return 0, err
	}
	if exists || delta < 0 {
		return 0, ErrBelowZero
	}
	return s.Set(ctx, productID, delta)
}

func (s *Store) List(ctx context.Context, min, max *int32) ([]Level, error) {
	rows, err := s.pool.Query(ctx, `SELECT product_id::text, quantity FROM stock
		WHERE ($1::int IS NULL OR quantity >= $1) AND ($2::int IS NULL OR quantity <= $2)
		ORDER BY quantity, product_id`, min, max)
	if err != nil {
		return nil, err
	}
	return collectLevels(rows)
}

func collectLevels(rows pgx.Rows) ([]Level, error) {
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Level, error) {
		var l Level
		err := row.Scan(&l.ProductID, &l.Quantity)
		return l, err
	})
}
