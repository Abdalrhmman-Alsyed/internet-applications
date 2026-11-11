# inventory-service (Go). The gRPC code is generated here from proto/inventory.proto,
# which compose passes in as the extra build context "proto".
FROM golang:1.22-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler && rm -rf /var/lib/apt/lists/*
RUN go install google.golang.org/protobuf/cmd/protoc-gen-go@v1.34.2 \
 && go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.4.0
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY --from=proto inventory.proto proto/inventory.proto
RUN protoc -I proto \
      --go_out=. --go_opt=module=github.com/Abdalrhmman-Alsyed/internet-applications/inventory-service \
      --go-grpc_out=. --go-grpc_opt=module=github.com/Abdalrhmman-Alsyed/internet-applications/inventory-service \
      proto/inventory.proto

COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/inventory-service .

# Tiny runtime image: just the static binary, no shell, runs as non-root.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/inventory-service /inventory-service
EXPOSE 50051
ENTRYPOINT ["/inventory-service"]
