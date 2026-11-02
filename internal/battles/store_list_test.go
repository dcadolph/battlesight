package battles

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"

	"github.com/dcadolph/battlesight/internal/db"
)

// listSeedCount is one more row than the old 10000-row default cap, so a cap
// on the oldest-first sort drops the newest row.
const listSeedCount = 10001

// openListStore seeds a temp db with listSeedCount verified rows, one per
// year from 1, plus one newer verified row without coordinates.
func openListStore(t *testing.T) *Store {
	t.Helper()
	conn, err := db.Open(filepath.Join(t.TempDir(), "list.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	ctx := context.Background()
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO battles (id, name, year, date, lat, lng, era, war,
		battle_type, victor, summary, significance, verified) VALUES (?, ?, ?, '', ?, ?, 'contemporary', '',
		'land', '', '', '', 1)`)
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	for i := 1; i <= listSeedCount; i++ {
		if _, err := stmt.ExecContext(ctx, fmt.Sprintf("b%05d", i), fmt.Sprintf("Battle %d", i), i, 1, 1); err != nil {
			t.Fatalf("insert %d: %v", i, err)
		}
	}
	if _, err := stmt.ExecContext(ctx, "nocoord", "No coord", listSeedCount+1, 0, 0); err != nil {
		t.Fatalf("insert nocoord: %v", err)
	}
	if err := stmt.Close(); err != nil {
		t.Fatalf("close stmt: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	return NewStore(conn)
}

// TestStoreList verifies that the default list returns every match, newest
// included, and that explicit limits and offsets still page.
func TestStoreList(t *testing.T) {
	t.Parallel()
	store := openListStore(t)
	tests := []struct {
		WantCount int
		WantTotal int
		WantFirst string
		WantLast  string
		In        Filter
	}{{ // Test 0: Default limit returns every row past the old cap.
		In: Filter{}, WantCount: listSeedCount, WantTotal: listSeedCount, WantFirst: "b00001", WantLast: "b10001",
	}, { // Test 1: Explicit limit pages oldest first.
		In: Filter{Limit: 2}, WantCount: 2, WantTotal: listSeedCount, WantFirst: "b00001", WantLast: "b00002",
	}, { // Test 2: Offset with no limit returns the tail.
		In: Filter{Offset: 10000}, WantCount: 1, WantTotal: listSeedCount, WantFirst: "b10001", WantLast: "b10001",
	}, { // Test 3: Year floor keeps the newest row.
		In: Filter{YearMin: 10001}, WantCount: 1, WantTotal: 1, WantFirst: "b10001", WantLast: "b10001",
	}, { // Test 4: Rows without coordinates join only when asked.
		In: Filter{YearMin: 10001, IncludeNoCoord: true}, WantCount: 2, WantTotal: 2,
		WantFirst: "b10001", WantLast: "nocoord",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, total, err := store.List(context.Background(), test.In)
			if err != nil {
				t.Fatalf("list: %v", err)
			}
			if diff := cmp.Diff(test.WantCount, len(got)); diff != "" {
				t.Errorf("count mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantTotal, total); diff != "" {
				t.Errorf("total mismatch (-want +got):\n%s", diff)
			}
			if len(got) == 0 {
				return
			}
			if diff := cmp.Diff(test.WantFirst, got[0].ID); diff != "" {
				t.Errorf("first mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantLast, got[len(got)-1].ID); diff != "" {
				t.Errorf("last mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
