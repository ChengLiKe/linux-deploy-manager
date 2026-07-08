# ---- Build Stage ----
FROM node:20-alpine AS node-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY web/ .
RUN npm run build

# ---- Go Build Stage ----
FROM golang:1.23-alpine AS go-builder
WORKDIR /app
RUN apk add --no-cache gcc musl-dev
COPY go.mod go.sum ./
RUN GOPROXY=https://goproxy.cn,direct go mod download
COPY . .
COPY --from=node-builder /app/web/dist cmd/server/web/dist
RUN go build -ldflags="-s -w -X main.version=1.0.0" -o linux-deploy-manager ./cmd/server

# ---- Runtime Stage ----
FROM alpine:3.19
RUN apk add --no-cache \
    bash \
    git \
    openssh-client \
    docker-cli \
    docker-compose \
    ca-certificates \
    tzdata \
    curl

COPY --from=go-builder /app/linux-deploy-manager /usr/local/bin/linux-deploy-manager

RUN mkdir -p /var/lib/linux-deploy-manager /var/log/linux-deploy-manager

EXPOSE 18081

ENTRYPOINT ["linux-deploy-manager"]
CMD ["-bind", "0.0.0.0", "-port", "18081", "--mode=release"]
