.PHONY: check test audit audit-db voicecheck names-out names-in run web import build-web help

help:
	@echo "make targets:"
	@echo "  run       - start the API server on :8080"
	@echo "  web       - start the Vite dev server on :5173 (proxies /api)"
	@echo "  test      - run all Go unit tests"
	@echo "  check     - test + audit + audit-db + voicecheck + Go build + TypeScript check"
	@echo "  audit     - validate data/battles.json, curated files and replays"
	@echo "  audit-db  - correctness mismatch report on the SQLite database"
	@echo "  voicecheck - check every replay's narration for words the voice would misread"
	@echo "  names-out - write name batches for ChatGPT and Gemini to NAMES_DIR (default ~/Downloads)"
	@echo "  names-in  - read their answers in NAMES_DIR into data/names.json"
	@echo "  import    - fetch/refresh Wikidata + Wikipedia data into the DB"
	@echo "  build-web - production frontend build"

test:
	go test ./...

audit:
	go run ./cmd/import -validate

# audit-db requires data/battlesight.db. The server seeds it on first start.
audit-db:
	go run ./cmd/quality -mismatch

# voicecheck requires data/battlesight.db and opens it read-only.
voicecheck:
	go run ./cmd/voicecheck -summary

# names-out writes the hand-built replays' names that lack a reading to NAMES_DIR as batches for
# ChatGPT and Gemini. names-in reads their pasted answers there back into data/names.json.
NAMES_DIR ?= $(HOME)/Downloads

names-out:
	go run ./cmd/voicecheck -hand -summary -names-out $(NAMES_DIR)

names-in:
	go run ./cmd/voicecheck -hand -summary -names-in $(NAMES_DIR)

check: test audit audit-db voicecheck
	go build ./...
	cd web && npx tsc -b --noEmit

run:
	go run ./cmd/battlesight

import:
	go run ./cmd/import -all

build-web:
	cd web && npm run build
