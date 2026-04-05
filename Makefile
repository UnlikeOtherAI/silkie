.PHONY: all build test lint lint-fix fmt vet tidy check ci web-lint clean

GO                := go
GOLANGCI_LINT     := golangci-lint
GOLANGCI_VERSION  := v1.61.0

all: check

## build: compile all Go packages
build:
	$(GO) build ./...

## test: run all Go tests with race detector
test:
	$(GO) test -race -count=1 ./...

## vet: run go vet
vet:
	$(GO) vet ./...

## fmt: format all Go sources with gofumpt + goimports
fmt:
	gofumpt -w .
	goimports -w -local github.com/unlikeotherai/silkie .

## tidy: tidy go.mod and verify module graph
tidy:
	$(GO) mod tidy
	$(GO) mod verify

## lint: run golangci-lint (installs it if missing)
lint:
	@if ! command -v $(GOLANGCI_LINT) >/dev/null 2>&1; then \
		echo "golangci-lint not found, installing $(GOLANGCI_VERSION)..."; \
		GOFLAGS= $(GO) install github.com/golangci/golangci-lint/cmd/golangci-lint@$(GOLANGCI_VERSION); \
	fi
	$(GOLANGCI_LINT) run ./...

## lint-fix: run golangci-lint with --fix
lint-fix:
	$(GOLANGCI_LINT) run --fix ./...

## web-lint: lint the static web assets (HTML)
web-lint:
	@if ! command -v npx >/dev/null 2>&1; then \
		echo "npx not found; skipping web lint"; \
		exit 0; \
	fi
	npx --yes htmlhint@1.1.4 "web/**/*.html"
	npx --yes prettier@3.3.3 --check "web/**/*.{html,css,js}"

## check: run the full strict pipeline (build, vet, lint, test)
check: build vet lint test

## ci: the canonical CI entrypoint
ci: tidy check web-lint

## clean: remove build artifacts
clean:
	$(GO) clean ./...
	rm -rf bin dist
