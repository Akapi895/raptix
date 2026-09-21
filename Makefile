# Raptix — Makefile (Phase 1). Go commands chạy bên trong backend/.
# Config mặc định nằm tại repo root: configs/app.yaml (qua đường dẫn ../).
# Chạy với `make <target>` từ WSL (go 1.26 trong WSL).

SHELL := /bin/bash

CONFIG ?= configs/app.yaml
CONFIG_PATH := $(abspath $(CONFIG))

.PHONY: build test vet tidy run migrate-up migrate-down migrate-status

build:
	cd backend && go build ./...

test:
	cd backend && go test -mod=readonly ./...

vet:
	cd backend && go vet ./...

tidy:
	cd backend && go mod tidy

run:
	cd backend && go run ./cmd/server -config "$(CONFIG_PATH)"

migrate-up:
	cd backend && go run ./cmd/migrate -config "$(CONFIG_PATH)" -dir migrations -command up

migrate-down:
	cd backend && go run ./cmd/migrate -config "$(CONFIG_PATH)" -dir migrations -command down

migrate-status:
	cd backend && go run ./cmd/migrate -config "$(CONFIG_PATH)" -dir migrations -command status
