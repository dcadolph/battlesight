package battles

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// TestReplaysLoad confirms the loader handles missing files, valid JSON,
// and indexes phases properly.
func TestReplaysLoad(t *testing.T) {
	t.Parallel()

	tests := []struct {
		Name     string
		Content  string
		WantN    int
		WantHas  string
		WantMiss string
	}{
		{
			Name:     "missing file is not an error",
			Content:  "",
			WantN:    0,
			WantMiss: "anything",
		},
		{
			Name: "loads valid replay map",
			Content: `{
				"marathon": {
					"title": "Marathon",
					"intro": "x",
					"factionA": "Greeks",
					"factionB": "Persians",
					"phases": [
						{"title": "deploy", "narration": "n", "units": []},
						{"title": "charge", "narration": "n", "units": []}
					]
				}
			}`,
			WantN:    1,
			WantHas:  "marathon",
			WantMiss: "cannae",
		},
	}

	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			dir := t.TempDir()
			r := NewReplays()

			var path string
			if test.Content != "" {
				path = filepath.Join(dir, "phases.json")
				if err := os.WriteFile(path, []byte(test.Content), 0o600); err != nil {
					t.Fatalf("write fixture: %v", err)
				}
			} else {
				path = filepath.Join(dir, "missing.json")
			}

			n, err := r.Load(path)
			if err != nil {
				t.Fatalf("Load returned error: %v", err)
			}
			if n != test.WantN {
				t.Errorf("loaded count = %d, want %d", n, test.WantN)
			}
			if test.WantHas != "" {
				rep, ok := r.Get(test.WantHas)
				if !ok {
					t.Errorf("expected to find %s", test.WantHas)
				} else {
					for i, p := range rep.Phases {
						if p.Index != i {
							t.Errorf("phase %d Index = %d, want %d", i, p.Index, i)
						}
					}
				}
			}
			if test.WantMiss != "" {
				if r.Has(test.WantMiss) {
					t.Errorf("did not expect to find %s", test.WantMiss)
				}
			}
		})
	}
}
