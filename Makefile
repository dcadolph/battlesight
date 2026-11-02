.PHONY: check test audit audit-db run web import build-web help

help:
	@echo "make targets:"
	@echo "  run       - start the API server on :8080"
	@echo "  web       - start the Vite dev server on :5173 (proxies /api)"
	@echo "  test      - run all Go unit tests"
	@echo "  check     - test + audit + audit-db + Go build + TypeScript check"
	@echo "  audit     - validate data/battles.json, curated files and replays"
	@echo "  audit-db  - correctness mismatch report on the SQLite database"
	@echo "  import    - fetch/refresh Wikidata + Wikipedia data into the DB"
	@echo "  build-web - production frontend build"

test:
	go test ./...

audit:
	go run ./cmd/import -validate

# audit-db requires data/battlesight.db. The server seeds it on first start.
audit-db:
	go run ./cmd/quality -mismatch

check: test audit audit-db
	go build ./...
	cd web && npx tsc -b --noEmit

run:
	go run ./cmd/battlesight

import:
	go run ./cmd/import -all

build-web:
	cd web && npm run build
