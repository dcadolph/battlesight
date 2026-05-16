.PHONY: check test audit run import build-web help

help:
	@echo "make targets:"
	@echo "  test     - run all Go unit tests"
	@echo "  audit    - run data integrity audit on data/*.json"
	@echo "  check    - test + audit + Go build + TypeScript check (run before any merge)"
	@echo "  run      - start the API server on :8080"
	@echo "  import   - fetch/refresh Wikidata + Wikipedia data into the DB"
	@echo "  build-web - production frontend build"

test:
	go test ./...

audit:
	python3 scripts/audit_data.py

check: test audit
	go build ./...
	cd web && npx tsc -b --noEmit

run:
	go run ./cmd/battletrace

import:
	go run ./cmd/import -all

build-web:
	cd web && npm run build
