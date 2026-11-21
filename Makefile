PY ?= venv/bin/python

.PHONY: dev-backend test test-network lint fmt \
	dev-frontend test-frontend build-frontend test-all serve

dev-backend:
	cd backend && ../$(PY) -m uvicorn app.main:create_app --factory --reload --port 8000

test:
	cd backend && ../$(PY) -m pytest -q

test-network:
	cd backend && ../$(PY) -m pytest -q -m network

lint:
	cd backend && ../venv/bin/ruff check . && ../venv/bin/ruff format --check .

fmt:
	cd backend && ../venv/bin/ruff format . && ../venv/bin/ruff check . --fix

dev-frontend:
	cd frontend && npm run dev

test-frontend:
	cd frontend && npm test

build-frontend:
	cd frontend && npm run build

test-all: test test-frontend

# Chạy bản production: backend phục vụ luôn frontend đã build (http://localhost:8000)
serve: build-frontend
	YT_STATIC_DIR=frontend/dist $(PY) -m uvicorn app.main:create_app --factory --app-dir backend --host 0.0.0.0 --port 8000
