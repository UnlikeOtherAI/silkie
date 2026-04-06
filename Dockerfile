FROM golang:1.25-alpine AS build

RUN apk add --no-cache git

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /selkie-server ./cmd/control-server

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

COPY --from=build /selkie-server /usr/local/bin/selkie-server
COPY migrations /app/migrations
COPY admin /app/admin
COPY assets /app/assets

WORKDIR /app
EXPOSE 8080

ENTRYPOINT ["selkie-server"]
