PY ?= venv/bin/python

.PHONY: dev-backend test test-network lint fmt

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
