package importer

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/dcadolph/battlesight/internal/db"
)

func TestCanonicalTitlesFor(t *testing.T) {
	t.Parallel()
	const page = `{"query":{"normalized":[{"from":"battle of a","to":"Battle of a"}],` +
		`"redirects":[{"from":"Battle of a","to":"Siege of A"},{"from":"Battle at B","to":"Battle of B"}],` +
		`"pages":[{"title":"Siege of A"},{"title":"Battle of B"},{"title":"Gone","missing":true}]}}`
	tests := []struct {
		Handle     http.HandlerFunc
		WantResult map[string]string
		WantCalls  int32
		Want       error
		WantErr    bool
	}{{ // Test 0: Normalized then redirected, redirected, and missing titles.
		Handle: func(w http.ResponseWriter, _ *http.Request) { fmt.Fprint(w, page) },
		WantResult: map[string]string{"battle of a": "Siege of A", "Battle at B": "Battle of B", "Gone": "",
			"Battle of B": "Battle of B"},
		WantCalls: 1,
	}, { // Test 1: Busy once, then answered.
		Handle: func() http.HandlerFunc {
			var n atomic.Int32
			return func(w http.ResponseWriter, _ *http.Request) {
				if n.Add(1) == 1 {
					w.Header().Set("Retry-After", "0")
					w.WriteHeader(http.StatusTooManyRequests)
					return
				}
				fmt.Fprint(w, page)
			}
		}(),
		WantResult: map[string]string{"battle of a": "Siege of A", "Battle at B": "Battle of B", "Gone": "",
			"Battle of B": "Battle of B"},
		WantCalls: 2,
	}, { // Test 2: Busy twice is ErrWikipediaBusy.
		Handle: func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(w, `{"error":{"code":"maxlag","info":"lagged"}}`)
		},
		Want: ErrWikipediaBusy, WantErr: true, WantCalls: 2,
	}, { // Test 3: Any other API error fails.
		Handle: func(w http.ResponseWriter, _ *http.Request) {
			fmt.Fprint(w, `{"error":{"code":"toomanyvalues","info":"too many"}}`)
		},
		WantErr: true, WantCalls: 1,
	}, { // Test 4: A server error fails.
		Handle:  func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) },
		WantErr: true, WantCalls: 1,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				test.Handle(w, r)
			}))
			t.Cleanup(srv.Close)
			got, err := canonicalTitlesFor(context.Background(), srv.URL,
				[]string{"battle of a", "Battle at B", "Gone", "Battle of B"})
			if (err != nil) != test.WantErr {
				t.Fatalf("err %v, want error %v", err, test.WantErr)
			}
			if test.Want != nil && !errors.Is(err, test.Want) {
				t.Errorf("err %v, want %v", err, test.Want)
			}
			if diff := cmp.Diff(test.WantCalls, calls.Load()); diff != "" {
				t.Errorf("calls mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("titles mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestReportCanonicalTitles(t *testing.T) {
	t.Parallel()
	all := []titleRow{{ID: "a", Title: "Battle at M"}, {ID: "b", Title: "Battle of M"}, {ID: "c", Title: "Gone"}}
	canon := map[string]string{"Battle at M": "Battle of M", "Battle of M": "Battle of M", "Gone": ""}
	var rep TitleReport
	reportCanonicalTitles(all, canon, &rep)
	want := TitleReport{Missing: []string{"c: Gone"}, Redirects: []string{"a: Battle at M -> Battle of M"}}
	if diff := cmp.Diff(want, rep, cmpopts.EquateEmpty()); diff != "" {
		t.Errorf("report mismatch (-want +got):\n%s", diff)
	}
}

// TestDeduplicateCarriesAlias pins that a merged row's name becomes an alias of the kept row.
func TestDeduplicateCarriesAlias(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	conn, err := db.Open(filepath.Join(t.TempDir(), "dedupe.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer conn.Close()
	insert := `INSERT INTO battles (id, name, year, date, date_start, date_end, lat, lng, era, war, battle_type,
		victor, summary, significance, wikipedia_title, source, source_id, verified)
		VALUES (?, ?, 1705, '1705', '1705-01-01', '1705-12-31', 30, 76, 'early-modern', '', 'land', '', ?, '',
		'Battle of M', 'wikidata', ?, 0)`
	for _, r := range [][]any{{"battle-at-m", "Battle at M", "", "Q1"}, {"battle-of-m", "Battle of M", "A summary.", "Q2"}} {
		if _, err := conn.ExecContext(ctx, insert, r...); err != nil {
			t.Fatalf("insert %v: %v", r[0], err)
		}
	}
	n, err := deduplicateWikipedia(ctx, conn)
	if err != nil {
		t.Fatalf("dedupe: %v", err)
	}
	if diff := cmp.Diff(1, n); diff != "" {
		t.Errorf("merged mismatch (-want +got):\n%s", diff)
	}
	var alias string
	if err := conn.QueryRowContext(ctx, `SELECT name FROM battle_aliases WHERE battle_id = 'battle-of-m'`).
		Scan(&alias); err != nil {
		t.Fatalf("alias: %v", err)
	}
	if diff := cmp.Diff("Battle at M", alias); diff != "" {
		t.Errorf("alias mismatch (-want +got):\n%s", diff)
	}
}
