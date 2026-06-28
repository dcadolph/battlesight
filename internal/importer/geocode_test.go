package importer

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

func TestResolveGeocodeTitles(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		Requested  []string
		WantResult map[string]geocodeCoordinate
	}{{ // Test 0: Direct title match with a primary coordinate.
		In: `{"query":{"pages":{"4849":{"pageid":4849,"title":"Battle of Gettysburg",
			"coordinates":[{"lat":39.81138889,"lon":-77.22583333,"type":"event"}]}}}}`,
		Requested: []string{"Battle of Gettysburg"},
		WantResult: map[string]geocodeCoordinate{
			"Battle of Gettysburg": {Lat: 39.81138889, Lon: -77.22583333, Type: "event"},
		},
	}, { // Test 1: Normalized title (underscores) maps back to the requested form.
		In: `{"query":{
			"normalized":[{"from":"Battle_of_Hastings","to":"Battle of Hastings"}],
			"pages":{"37525":{"title":"Battle of Hastings",
			"coordinates":[{"lat":50.91,"lon":0.487,"type":"event"}]}}}}`,
		Requested: []string{"Battle_of_Hastings"},
		WantResult: map[string]geocodeCoordinate{
			"Battle_of_Hastings": {Lat: 50.91, Lon: 0.487, Type: "event"},
		},
	}, { // Test 2: Normalization then redirect chains to the final page.
		In: `{"query":{
			"normalized":[{"from":"battle of stalingrad","to":"Battle of stalingrad"}],
			"redirects":[{"from":"Battle of stalingrad","to":"Battle of Stalingrad"}],
			"pages":{"4128":{"title":"Battle of Stalingrad",
			"coordinates":[{"lat":48.7,"lon":44.5167,"type":"event"}]}}}}`,
		Requested: []string{"battle of stalingrad"},
		WantResult: map[string]geocodeCoordinate{
			"battle of stalingrad": {Lat: 48.7, Lon: 44.5167, Type: "event"},
		},
	}, { // Test 3: Missing page yields no entry for its requested title.
		In:         `{"query":{"pages":{"-1":{"title":"Battle of Nowhere","missing":""}}}}`,
		Requested:  []string{"Battle of Nowhere"},
		WantResult: map[string]geocodeCoordinate{},
	}, { // Test 4: Page present but without coordinates yields no entry.
		In:         `{"query":{"pages":{"13669453":{"title":"Battle of Jwawon"}}}}`,
		Requested:  []string{"Battle of Jwawon"},
		WantResult: map[string]geocodeCoordinate{},
	}, { // Test 5: Redirect cycle terminates at the hop cap without a hit.
		In: `{"query":{
			"redirects":[{"from":"Loop A","to":"Loop B"},{"from":"Loop B","to":"Loop A"}],
			"pages":{}}}`,
		Requested:  []string{"Loop A"},
		WantResult: map[string]geocodeCoordinate{},
	}, { // Test 6: Mixed batch resolves hits and drops misses independently.
		In: `{"query":{
			"normalized":[{"from":"Siege_of_Vienna","to":"Siege of Vienna"}],
			"pages":{
			"100":{"title":"Siege of Vienna",
			"coordinates":[{"lat":48.2082,"lon":16.3738,"type":"city"}]},
			"-1":{"title":"Battle of Missing","missing":""}}}}`,
		Requested: []string{"Siege_of_Vienna", "Battle of Missing"},
		WantResult: map[string]geocodeCoordinate{
			"Siege_of_Vienna": {Lat: 48.2082, Lon: 16.3738, Type: "city"},
		},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			var resp geocodeResponse
			if err := json.Unmarshal([]byte(test.In), &resp); err != nil {
				t.Fatalf("unmarshal response: %v", err)
			}
			got := resolveGeocodeTitles(test.Requested, &resp)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestRetryAfterDelay(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult time.Duration
	}{{ // Test 0: Absent header falls back to the floor.
		In: "", WantResult: 2 * time.Second,
	}, { // Test 1: Header above the floor is honored.
		In: "30", WantResult: 30 * time.Second,
	}, { // Test 2: Header below the floor is raised to it.
		In: "1", WantResult: 2 * time.Second,
	}, { // Test 3: Unparseable header falls back to the floor.
		In: "Fri, 05 Jul 2026 12:00:00 GMT", WantResult: 2 * time.Second,
	}, { // Test 4: Header beyond the cap is clamped.
		In: "3600", WantResult: 2 * time.Minute,
	}, { // Test 5: Zero and negative values fall back to the floor.
		In: "-5", WantResult: 2 * time.Second,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := retryAfterDelay(test.In)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestGeocodeAcceptable(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         geocodeCoordinate
		WantResult bool
	}{{ // Test 0: Ordinary event coordinate is accepted.
		In: geocodeCoordinate{Lat: 39.81, Lon: -77.22, Type: "event"}, WantResult: true,
	}, { // Test 1: Country-level centroid is too coarse.
		In: geocodeCoordinate{Lat: 46.0, Lon: 2.0, Type: "country"}, WantResult: false,
	}, { // Test 2: Null island placeholder is rejected.
		In: geocodeCoordinate{Lat: 0, Lon: 0, Type: "event"}, WantResult: false,
	}, { // Test 3: Latitude above range is rejected.
		In: geocodeCoordinate{Lat: 90.5, Lon: 10, Type: "event"}, WantResult: false,
	}, { // Test 4: Longitude below range is rejected.
		In: geocodeCoordinate{Lat: 10, Lon: -180.5, Type: "event"}, WantResult: false,
	}, { // Test 5: Boundary values are accepted.
		In: geocodeCoordinate{Lat: -90, Lon: 180, Type: "landmark"}, WantResult: true,
	}, { // Test 6: Unspecified type is accepted.
		In: geocodeCoordinate{Lat: 51.5, Lon: -0.12, Type: ""}, WantResult: true,
	}, { // Test 7: Zero latitude with nonzero longitude is a real place.
		In: geocodeCoordinate{Lat: 0, Lon: 32.58, Type: "city"}, WantResult: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := geocodeAcceptable(test.In)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
