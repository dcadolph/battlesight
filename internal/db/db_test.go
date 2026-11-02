package db

import (
	"fmt"
	"path/filepath"
	"testing"
)

// TestOpenAddsColumns opens one database twice. The added columns exist after
// the first open and the second open does not fail on them.
func TestOpenAddsColumns(t *testing.T) {
	t.Parallel()
	path := filepath.Join(t.TempDir(), "cols.db")
	for pass := range 2 {
		conn, err := Open(path)
		if err != nil {
			t.Fatalf("open pass %d: %v", pass, err)
		}
		for _, c := range addedColumns {
			t.Run(fmt.Sprintf("pass %d %s", pass, c.Name), func(t *testing.T) {
				var n int
				err := conn.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name = ?`, c.Table, c.Name).Scan(&n)
				if err != nil || n != 1 {
					t.Errorf("column %s.%s: count %d, err %v, want 1 and nil", c.Table, c.Name, n, err)
				}
			})
		}
		conn.Close()
	}
}
