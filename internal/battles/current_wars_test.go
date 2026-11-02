package battles

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// TestClassifyCurrent verifies which wars count as ongoing and which as undated.
func TestClassifyCurrent(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult CurrentWars
		In         map[string]WarNarrative
	}{{ // Test 0: A start year with no end year is ongoing, and its aliases come along.
		In: map[string]WarNarrative{
			"Gaza war": {StartYear: 2023, Aliases: []string{"Israel–Hamas war"}},
		},
		WantResult: CurrentWars{Current: []string{"Gaza war", "Israel–Hamas war"}},
	}, { // Test 1: An end year makes a war ended, so it is in neither list.
		In:         map[string]WarNarrative{"Tigray War": {StartYear: 2020, EndYear: 2022}},
		WantResult: CurrentWars{},
	}, { // Test 2: A child with no years inherits an ongoing parent.
		In: map[string]WarNarrative{
			"Gaza war":                           {StartYear: 2023},
			"Israeli invasion of the Gaza Strip": {Parent: "Gaza war"},
		},
		WantResult: CurrentWars{Current: []string{"Gaza war", "Israeli invasion of the Gaza Strip"}},
	}, { // Test 3: A child with its own end year is ended under an ongoing parent.
		In: map[string]WarNarrative{
			"Russo-Ukrainian War":       {StartYear: 2014},
			"War in Donbas (2014–2022)": {StartYear: 2014, EndYear: 2022, Parent: "Russo-Ukrainian War"},
		},
		WantResult: CurrentWars{Current: []string{"Russo-Ukrainian War"}},
	}, { // Test 4: No year anywhere on the chain is missing data, not ongoing.
		In: map[string]WarNarrative{
			"Second Nagorno-Karabakh War": {},
			"Child":                       {Parent: "Second Nagorno-Karabakh War"},
		},
		WantResult: CurrentWars{Missing: []string{"Child", "Second Nagorno-Karabakh War"}},
	}, { // Test 5: An end year with no start year is ended.
		In:         map[string]WarNarrative{"Old war": {EndYear: 1815}},
		WantResult: CurrentWars{},
	}, { // Test 6: A parent that is not a key and a parent cycle are both missing.
		In: map[string]WarNarrative{
			"Orphan": {Parent: "Nowhere"},
			"A":      {Parent: "B"},
			"B":      {Parent: "A"},
		},
		WantResult: CurrentWars{Missing: []string{"A", "B", "Orphan"}},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := ClassifyCurrent(test.In)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestCurrentWarsHandler verifies the endpoint serves the loaded registry's set.
func TestCurrentWarsHandler(t *testing.T) {
	t.Parallel()
	wars := NewWars()
	wars.byName = map[string]WarNarrative{
		"Gaza war":   {StartYear: 2023, Aliases: []string{"Israel–Hamas war"}},
		"Tigray War": {StartYear: 2020, EndYear: 2022},
	}
	h := &Handler{store: &Store{}, replays: NewReplays(), wars: wars}
	mux := http.NewServeMux()
	h.RegisterRoutes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/wars/current", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d", rec.Code)
	}
	var got CurrentWars
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := CurrentWars{Current: []string{"Gaza war", "Israel–Hamas war"}, Missing: []string{}}
	if diff := cmp.Diff(want, got, cmpopts.EquateEmpty()); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}
