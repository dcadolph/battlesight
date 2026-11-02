package db

import (
	"database/sql"
	"embed"
	"fmt"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Open creates or opens a SQLite database at the given path and runs migrations.
func Open(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	if err := pragmas(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("set pragmas: %w", err)
	}

	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	if err := addColumns(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("add columns: %w", err)
	}

	return db, nil
}

// OpenReadOnly opens an existing SQLite database without running migrations or
// changing the journal mode, so audits never write to it.
func OpenReadOnly(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open database read-only: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping database read-only: %w", err)
	}
	return db, nil
}

// pragmas sets performance and correctness pragmas.
func pragmas(db *sql.DB) error {
	stmts := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
		"PRAGMA busy_timeout=5000",
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("%s: %w", s, err)
		}
	}
	return nil
}

// migrate runs all embedded SQL migration files in order.
func migrate(db *sql.DB) error {
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	for _, entry := range entries {
		data, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}

		if _, err := db.Exec(string(data)); err != nil {
			return fmt.Errorf("execute migration %s: %w", entry.Name(), err)
		}
	}

	return nil
}

// addedColumn is a column added to an existing table after its CREATE
// migration. SQLite has no ADD COLUMN IF NOT EXISTS, so these run from Go.
type addedColumn struct {
	// Table is the table the column belongs to.
	Table string
	// Name is the column name.
	Name string
	// Decl is the column type and constraints.
	Decl string
}

// addedColumns lists every column added after its table's CREATE migration.
// The wikidata_* columns record what Wikidata itself says about a row, and the
// infobox_* columns what the article's infobox date and partof say, so the cleanse pass can
// check year, date and war against named sources. coord_source names the source the
// row's coordinates agree with, and coord_checked the day the sources were last read.
var addedColumns = []addedColumn{
	{Table: "battles", Name: "wikidata_date", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "wikidata_precision", Decl: "INTEGER NOT NULL DEFAULT 0"},
	{Table: "battles", Name: "wikidata_end", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "wikidata_end_precision", Decl: "INTEGER NOT NULL DEFAULT 0"},
	{Table: "battles", Name: "wikidata_conflict", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "wikidata_instance_of", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "wikidata_checked", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "infobox_date", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "infobox_partof", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "infobox_checked", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "coord_source", Decl: "TEXT NOT NULL DEFAULT ''"},
	{Table: "battles", Name: "coord_checked", Decl: "TEXT NOT NULL DEFAULT ''"},
}

// addColumns adds each column in addedColumns that its table lacks.
func addColumns(db *sql.DB) error {
	for _, c := range addedColumns {
		var n int
		err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, c.Table, c.Name).Scan(&n)
		if err != nil {
			return fmt.Errorf("read %s columns: %w", c.Table, err)
		}
		if n > 0 {
			continue
		}
		if _, err := db.Exec("ALTER TABLE " + c.Table + " ADD COLUMN " + c.Name + " " + c.Decl); err != nil {
			return fmt.Errorf("add %s.%s: %w", c.Table, c.Name, err)
		}
	}
	return nil
}
