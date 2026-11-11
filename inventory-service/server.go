package main

import (
	"context"
	"errors"
	"regexp"
	"sort"
	"strconv"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	inventoryv1 "github.com/Abdalrhmman-Alsyed/internet-applications/inventory-service/gen/inventoryv1"
)

const maxQuantity = 10_000

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// Server implements inventory.v1.InventoryService (generated from proto/inventory.proto).
type Server struct {
	inventoryv1.UnimplementedInventoryServiceServer
	store *Store
}

func (s *Server) CheckStock(ctx context.Context, req *inventoryv1.CheckStockRequest) (*inventoryv1.CheckStockResponse, error) {
	ids := req.GetProductIds()
	for _, id := range ids {
		if !uuidRe.MatchString(id) {
			return nil, status.Errorf(codes.InvalidArgument, "invalid product id %q", id)
		}
	}
	found, err := s.store.Check(ctx, ids)
	if err != nil {
		return nil, toStatus(ctx, err)
	}
	// Every requested product is in the answer; one without a stock record has 0.
	res := &inventoryv1.CheckStockResponse{Items: make([]*inventoryv1.StockLevel, 0, len(ids))}
	for _, id := range ids {
		res.Items = append(res.Items, &inventoryv1.StockLevel{ProductId: id, Quantity: found[id]})
	}
	return res, nil
}

func (s *Server) ReserveStock(ctx context.Context, req *inventoryv1.ReserveStockRequest) (*inventoryv1.ReserveStockResponse, error) {
	if !uuidRe.MatchString(req.GetReservationId()) {
		return nil, status.Error(codes.InvalidArgument, "reservation_id must be a UUID")
	}
	if len(req.GetItems()) == 0 {
		return nil, status.Error(codes.InvalidArgument, "at least one item is required")
	}
	// The same product twice in one order counts as one line.
	merged := map[string]int32{}
	for _, it := range req.GetItems() {
		if !uuidRe.MatchString(it.GetProductId()) {
			return nil, status.Errorf(codes.InvalidArgument, "invalid product id %q", it.GetProductId())
		}
		if it.GetQuantity() <= 0 || it.GetQuantity() > maxQuantity {
			return nil, status.Errorf(codes.InvalidArgument, "quantity must be between 1 and %d", maxQuantity)
		}
		merged[it.GetProductId()] += it.GetQuantity()
	}
	items := make([]Item, 0, len(merged))
	for id, q := range merged {
		items = append(items, Item{id, q})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ProductID < items[j].ProductID })

	remaining, err := s.store.Reserve(ctx, req.GetReservationId(), items)
	if err != nil {
		return nil, toStatus(ctx, err)
	}
	return &inventoryv1.ReserveStockResponse{ReservationId: req.GetReservationId(), Remaining: toProto(remaining)}, nil
}

func (s *Server) ReleaseStock(ctx context.Context, req *inventoryv1.ReleaseStockRequest) (*inventoryv1.ReleaseStockResponse, error) {
	if !uuidRe.MatchString(req.GetReservationId()) {
		return nil, status.Error(codes.InvalidArgument, "reservation_id must be a UUID")
	}
	restored, err := s.store.Release(ctx, req.GetReservationId())
	if err != nil {
		return nil, toStatus(ctx, err)
	}
	return &inventoryv1.ReleaseStockResponse{Released: len(restored) > 0, Restored: toProto(restored)}, nil
}

func (s *Server) SetStock(ctx context.Context, req *inventoryv1.SetStockRequest) (*inventoryv1.StockLevel, error) {
	if !uuidRe.MatchString(req.GetProductId()) {
		return nil, status.Errorf(codes.InvalidArgument, "invalid product id %q", req.GetProductId())
	}
	var (
		q   int32
		err error
	)
	switch change := req.GetChange().(type) {
	case *inventoryv1.SetStockRequest_Quantity:
		if change.Quantity < 0 || change.Quantity > maxQuantity*100 {
			return nil, status.Error(codes.InvalidArgument, "quantity is out of range")
		}
		q, err = s.store.Set(ctx, req.GetProductId(), change.Quantity)
	case *inventoryv1.SetStockRequest_Delta:
		q, err = s.store.Adjust(ctx, req.GetProductId(), change.Delta)
	default:
		return nil, status.Error(codes.InvalidArgument, "provide either quantity or delta")
	}
	if err != nil {
		return nil, toStatus(ctx, err)
	}
	return &inventoryv1.StockLevel{ProductId: req.GetProductId(), Quantity: q}, nil
}

func (s *Server) ListStock(ctx context.Context, req *inventoryv1.ListStockRequest) (*inventoryv1.CheckStockResponse, error) {
	levels, err := s.store.List(ctx, req.MinQuantity, req.MaxQuantity)
	if err != nil {
		return nil, toStatus(ctx, err)
	}
	return &inventoryv1.CheckStockResponse{Items: toProto(levels)}, nil
}

// toStatus maps domain errors to gRPC status codes. The product id and available
// quantity also travel as trailers so the caller can name the product.
func toStatus(ctx context.Context, err error) error {
	var insufficient *InsufficientError
	var notFound *NotFoundError
	switch {
	case errors.As(err, &insufficient):
		_ = grpc.SetTrailer(ctx, metadata.Pairs(
			"product-id", insufficient.ProductID,
			"available", strconv.Itoa(int(insufficient.Available)),
		))
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.As(err, &notFound):
		_ = grpc.SetTrailer(ctx, metadata.Pairs("product-id", notFound.ProductID))
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, ErrBelowZero):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, ErrReservationClosed):
		return status.Error(codes.Aborted, err.Error())
	case errors.Is(err, context.DeadlineExceeded):
		return status.Error(codes.DeadlineExceeded, "deadline exceeded")
	case errors.Is(err, context.Canceled):
		return status.Error(codes.Canceled, "request cancelled by the caller")
	default:
		return status.Error(codes.Internal, "inventory error")
	}
}

func toProto(levels []Level) []*inventoryv1.StockLevel {
	out := make([]*inventoryv1.StockLevel, 0, len(levels))
	for _, l := range levels {
		out = append(out, &inventoryv1.StockLevel{ProductId: l.ProductID, Quantity: l.Quantity})
	}
	return out
}

func sortLevels(levels []Level) {
	sort.Slice(levels, func(i, j int) bool { return levels[i].ProductID < levels[j].ProductID })
}

func codeOf(err error) codes.Code {
	return status.Code(err)
}
