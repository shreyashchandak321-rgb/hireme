# Build from the pinned upstream source directory prepared by setup.sh.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/server ./cmd/migrate ./cmd/add-board ./cmd/ingest ./cmd/reindex ./cmd/search-drain
FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && useradd --system --uid 65532 --create-home worker
WORKDIR /app
COPY --from=build /out/ /app/
COPY --from=build /src/migrations /app/migrations
USER worker
CMD ["/app/server"]
