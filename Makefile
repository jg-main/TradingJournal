# Trading Journal — Makefile
# Convenience commands for common dev tasks.
# Run `make` or `make help` to see all targets.

.PHONY: help dev dev-alt build start lint typecheck test test-all test-watch playwright playwright-ui \
        db-generate db-migrate db-studio seed seed-settings setup reset-db clean \
        docker-build docker-up docker-upgrade docker-down docker-restart docker-logs

# ─── Configuration ──────────────────────────────────────────────────────────

NPM   := npm
NPX   := npx
PORT  ?= 3000
ALT_PORT := 3456

# ─── Help ───────────────────────────────────────────────────────────────────

help: ## Show this help
	@echo "Usage: make <target>"
	@echo ""
	@grep -Eh '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ─── Development ────────────────────────────────────────────────────────────

dev: ## Start Next.js dev server with webpack (port $(PORT))
	$(NPM) run dev -- --webpack -p $(PORT)

dev-alt: ## Start dev server with webpack (port $(ALT_PORT), for Playwright)
	$(NPM) run dev -- --webpack -p $(ALT_PORT)

build: ## Build for production (--webpack: see next.config.ts for turbopack config)
	$(NPM) run build -- --webpack

start: ## Start production server (port $(PORT))
	$(NPM) run start -- -p $(PORT)

# ─── Code Quality ───────────────────────────────────────────────────────────

lint: ## Run ESLint
	$(NPM) run lint

typecheck: ## Run TypeScript type checking (no emit)
	$(NPX) tsc --noEmit

# ─── Tests ──────────────────────────────────────────────────────────────────

test: ## Run unit tests (vitest)
	$(NPX) vitest run --reporter verbose

test-all: ## Run all test suites (vitest + consolidation tsx tests)
	$(NPX) tsx scripts/run-all-tests.ts

test-watch: ## Run unit tests in watch mode
	$(NPX) vitest --reporter verbose

playwright: ## Run Playwright e2e tests (headless)
	$(NPX) playwright test --project=chromium
	$(NPX) playwright test --project=firefox
	$(NPX) playwright test --project=webkit

playwright-ui: ## Run Playwright e2e tests in UI mode
	$(NPX) playwright test --ui

playwright-debug: ## Run Playwright e2e tests (headed, one worker)
	$(NPX) playwright test --headed --workers 1

# ─── Database ───────────────────────────────────────────────────────────────

db-generate: ## Generate Drizzle migration from schema
	$(NPX) drizzle-kit generate

db-migrate: ## Run pending Drizzle migrations
	$(NPX) drizzle-kit migrate

db-studio: ## Open Drizzle Studio (GUI for the DB)
	$(NPX) drizzle-kit studio

seed: ## Seed database with reference data (lookup_values)
	$(NPX) tsx src/db/seed.ts

seed-settings: ## Regenerate data/settings_init.zip from current database (requires running dev server)
	@echo "Creating fresh backup via /api/backup/now..."
	@BACKUP_RESPONSE=$$(curl -sf -X POST http://localhost:3000/api/backup/now) && \
		echo "$$BACKUP_RESPONSE" && \
		BACKUP_FILE=$$(ls -t .trading-journal/backups/*.zip 2>/dev/null | head -1) && \
		cp "$$BACKUP_FILE" data/settings_init.zip && \
		python3 -c "import zipfile,json; m=json.loads(zipfile.ZipFile('data/settings_init.zip').read('manifest.json')); print(f'Updated settings_init.zip — schema v{m[\"schemaVersion\"]}, {len(m[\"tables\"])} tables')" || \
		(echo "Error: Make sure the dev server is running (make dev) before running this target." && false)

seed-10k: ## Seed 10K benchmark trades
	$(NPX) tsx src/db/seed-10k.ts

benchmark: ## Run performance benchmark (seeds + measures API response times)
	$(NPX) tsx src/db/benchmark.ts

db-reset: ## Drop and recreate the database, run migrations and seed
	@rm -f .trading-journal/journal.db .trading-journal/journal.db-wal .trading-journal/journal.db-shm
	$(NPX) drizzle-kit migrate
	$(NPX) tsx src/db/seed.ts
	@echo "Database reset complete."

# ─── Setup & Cleanup ────────────────────────────────────────────────────────

setup: ## Install dependencies and seed the database
	$(NPM) ci
	$(NPX) drizzle-kit migrate
	$(NPX) tsx src/db/seed.ts
	@echo ""
	@echo "Setup complete. Run 'make dev' to start."

clean: ## Remove build artifacts and node_modules (keeps DB)
	rm -rf .next
	rm -rf node_modules
	rm -rf playwright-report test-results

# ─── Docker ────────────────────────────────────────────────────────────────

HOMELAB_DIR := $(HOME)/Projects/HomeLab

docker-build: ## Build the Docker image (trading-journal:latest)
	docker build -t trading-journal:latest .

docker-up: ## Build and start the trading-journal service in HomeLab
	docker build -t trading-journal:latest .
	docker compose -f $(HOMELAB_DIR)/docker-compose.yaml up -d trading-journal

docker-upgrade: ## Rebuild image and restart the service
	docker build -t trading-journal:latest .
	docker compose -f $(HOMELAB_DIR)/docker-compose.yaml up -d trading-journal

docker-down: ## Stop and remove the trading-journal service
	docker compose -f $(HOMELAB_DIR)/docker-compose.yaml down trading-journal

docker-restart: ## Restart the trading-journal service without rebuild
	docker compose -f $(HOMELAB_DIR)/docker-compose.yaml restart trading-journal

docker-logs: ## Follow trading-journal container logs
	docker compose -f $(HOMELAB_DIR)/docker-compose.yaml logs -f trading-journal

# ─── All-in-one ─────────────────────────────────────────────────────────────

all: setup typecheck build ## Setup, typecheck, and build
	@echo "All done."
