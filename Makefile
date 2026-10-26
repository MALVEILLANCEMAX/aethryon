# AETHRYON — development commands. None of them deploys anything.
COMPOSE := docker-compose -p aethryon-dev -f compose.dev.yml
.PHONY: help dev-secrets dev-downloads dev-build dev-up dev-down dev-logs test test-errors test-platforms test-account test-media-api \
	test-web test-extension test-discord test-premiere-panel test-desktop-core test-shortcut scan

help:
	@echo "make dev-secrets       random local secrets in .dev/secrets (never printed)"
	@echo "make dev-build         build the web, account and media-api images (media API with a fake worker)"
	@echo "make dev-up            start the stack on 127.0.0.1 (site :18110, media API :18111)"
	@echo "make dev-down          stop the stack (the account volume is kept)"
	@echo "make test              all unit tests that run without network access"
	@echo "make scan              secret scan of the working tree with gitleaks (Docker)"

dev-secrets:
	scripts/dev-secrets.sh

dev-downloads:
	apps/web/scripts/fetch-downloads.sh

dev-build: dev-downloads
	$(COMPOSE) build web account media-api

dev-up: dev-secrets
	$(COMPOSE) up -d web account media-api

dev-down:
	$(COMPOSE) down

dev-logs:
	$(COMPOSE) logs --tail=100 -f

test: test-errors test-platforms test-account test-media-api test-web test-extension test-discord test-premiere-panel

test-errors:
	python3 scripts/check-error-codes.py

test-platforms:
	python3 scripts/sync-plateformes.py --check
	cd apps/web && node --test tests/plateformes.test.ts tests/liens.test.ts

test-account:
	cd apps/account && npm ci --no-audit --no-fund && npm run typecheck && npm test

test-media-api:
	docker build --target test -t aethryon-media-api:test apps/media-api
	docker run --rm --network none aethryon-media-api:test

test-web:
	cd apps/web && npm ci --no-audit --no-fund && ALLOW_LEGAL_PLACEHOLDERS=1 VITE_LEGAL_DRAFT=1 npm run build

test-extension:
	cd apps/extension && npm ci --no-audit --no-fund && npm run typecheck && npm test && npm run build

test-discord:
	cd apps/discord-bot && npm ci --no-audit --no-fund && npm run typecheck && npm test

test-premiere-panel:
	cd apps/premiere-panel && npm ci --no-audit --no-fund && npm run typecheck && npm test

test-desktop-core:
	cd apps/desktop && cargo test -p aethryon-noyau -p aethryon-archive-extension

test-shortcut:
	cd shortcuts/ios && python3 -m venv .venv && .venv/bin/pip install -q --require-hashes --only-binary=:all: -r tools/requirements.txt \
		&& .venv/bin/python tools/inspect_signed.py dist/AETHRYON.shortcut && .venv/bin/python tools/validate.py dist/AETHRYON.shortcut \
		&& cd dist && sha256sum -c AETHRYON.shortcut.sha256

scan:
	docker run --rm --network none -v "$(CURDIR)":/repo:ro ghcr.io/gitleaks/gitleaks:v8.28.0 dir /repo --config /repo/.gitleaks.toml --redact --no-banner
