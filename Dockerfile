# Build the frontend.
FROM node:26-alpine AS frontend
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Build the server binary. modernc.org/sqlite is pure Go, so CGO stays off and
# the result is a static binary that runs on distroless.
FROM golang:1.26-alpine AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/battlesight ./cmd/battlesight

# Assemble the runtime image. The SQLite database is baked in; the startup
# migrate/cleanse passes write to it, so the data directory must be writable by
# the nonroot user.
FROM gcr.io/distroless/static:nonroot
WORKDIR /app
COPY --from=backend /out/battlesight ./battlesight
COPY --from=frontend /web/dist ./web/dist
COPY --chown=nonroot:nonroot data/battlesight.db ./data/battlesight.db
COPY data/battles.json data/phases.json data/wars.json ./data/
EXPOSE 8080
ENTRYPOINT ["/app/battlesight"]
