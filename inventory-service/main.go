// inventory-service: owns product stock and serves it over gRPC.
//
// It is the only service in Go (the rest is NestJS) and has its own database,
// inventory_db. Callers: orders-service (reserve / release), products-service
// (stock shown with products, admin changes) and the API gateway (health).
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	inventoryv1 "github.com/Abdalrhmman-Alsyed/internet-applications/inventory-service/gen/inventoryv1"
)

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe the local server and exit (Docker healthcheck)")
	flag.Parse()

	port := env("GRPC_PORT", "50051")
	if *healthcheck {
		os.Exit(probe(port))
	}

	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dbURL := env("INVENTORY_DATABASE_URL", "postgres://app:app_password@localhost:5433/inventory_db")
	store, err := OpenStore(ctx, dbURL, log)
	if err != nil {
		log.Error("database", "err", err)
		os.Exit(1)
	}
	defer store.Close()

	// Lets us show the "inventory is slow" case: every call waits this long first.
	latencyMs, _ := strconv.Atoi(env("SIMULATE_LATENCY_MS", "0"))

	srv := grpc.NewServer(grpc.UnaryInterceptor(interceptor(log, time.Duration(latencyMs)*time.Millisecond)))
	inventoryv1.RegisterInventoryServiceServer(srv, &Server{store: store})
	healthpb.RegisterHealthServer(srv, health.NewServer()) // standard gRPC health check
	reflection.Register(srv)                                 // lets grpcurl list and call methods

	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Error("listen", "err", err)
		os.Exit(1)
	}
	go func() {
		<-ctx.Done()
		log.Info("shutting down")
		srv.GracefulStop()
	}()

	log.Info("inventory-service listening", "grpc_port", port, "simulated_latency_ms", latencyMs)
	if err := srv.Serve(lis); err != nil {
		log.Error("serve", "err", err)
		os.Exit(1)
	}
}

// interceptor logs every call (method, duration, status) and applies the simulated latency.
// The wait respects the caller's deadline: if the caller gives up, we stop too.
func interceptor(log *slog.Logger, latency time.Duration) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
		started := time.Now()
		if latency > 0 {
			select {
			case <-time.After(latency):
			case <-ctx.Done():
				log.Warn("caller gave up", "method", info.FullMethod, "after", time.Since(started).Round(time.Millisecond))
				return nil, ctx.Err()
			}
		}
		res, err := handler(ctx, req)
		log.Info("rpc", "method", info.FullMethod, "ms", time.Since(started).Milliseconds(), "code", codeOf(err))
		return res, err
	}
}

// probe calls the gRPC health service on this container; exit code 0 means healthy.
func probe(port string) int {
	conn, err := grpc.NewClient("localhost:"+port, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return 1
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	res, err := healthpb.NewHealthClient(conn).Check(ctx, &healthpb.HealthCheckRequest{})
	if err != nil || res.GetStatus() != healthpb.HealthCheckResponse_SERVING {
		fmt.Fprintln(os.Stderr, "unhealthy:", err)
		return 1
	}
	return 0
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
