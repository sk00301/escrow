# ── AI Verification Service — Developer Makefile ────────────────────────────
# Usage:  make <target>

.PHONY: dev install test lint format clean docker-up docker-down

# ── Development server ───────────────────────────────────────────────────────
dev:
	uvicorn main:app --reload --host 0.0.0.0 --port 8000

# ── Dependencies ─────────────────────────────────────────────────────────────
install:
	pip install -r requirements.txt

# ── Tests ────────────────────────────────────────────────────────────────────
test:
	pytest tests/ -v

test-unit:
	pytest tests/unit/ -v

test-integration:
	pytest tests/integration/ -v

test-cov:
	pytest tests/ --cov=app --cov-report=html && open htmlcov/index.html

# ── Linting ──────────────────────────────────────────────────────────────────
lint:
	flake8 app/ main.py
	pylint app/ main.py --fail-under=7.0

# ── Formatting ───────────────────────────────────────────────────────────────
format:
	black app/ main.py tests/
	isort app/ main.py tests/

# ── Docker Compose (Redis for Celery) ────────────────────────────────────────
docker-up:
	docker compose -f docker/docker-compose.dev.yml up -d

docker-down:
	docker compose -f docker/docker-compose.dev.yml down

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -f verification_jobs.db
	rm -rf htmlcov .coverage
