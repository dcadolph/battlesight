package importer

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// testLandMaskPath is the world-atlas land file the audit ships with.
const testLandMaskPath = "../../data/land-50m.json"

// testLandMask loads the shipped land mask or fails the test.
func testLandMask(t *testing.T) *LandMask {
	t.Helper()
	m, err := LoadLandMask(testLandMaskPath)
	if err != nil {
		t.Fatalf("load land mask: %v", err)
	}
	return m
}

// TestLandMaskOnLand pins land and sea answers, including points on the Eurasia
// polygon near and across the antimeridian.
func TestLandMaskOnLand(t *testing.T) {
	t.Parallel()
	mask := testLandMask(t)
	tests := []struct {
		Name       string
		Lat, Lng   float64
		TolKM      float64
		WantOnLand bool
	}{{ // Test 0: Kyiv.
		Name: "kyiv", Lat: 50.45, Lng: 30.52, WantOnLand: true,
	}, { // Test 1: Paris.
		Name: "paris", Lat: 48.86, Lng: 2.35, WantOnLand: true,
	}, { // Test 2: Rovaniemi, north of the latitude where the antimeridian seam broke the ray cast.
		Name: "rovaniemi", Lat: 66.50, Lng: 25.73, WantOnLand: true,
	}, { // Test 3: Salla, a former false positive.
		Name: "salla", Lat: 66.83, Lng: 28.67, WantOnLand: true,
	}, { // Test 4: Gratangen, a former false positive.
		Name: "gratangen", Lat: 68.69, Lng: 17.53, WantOnLand: true,
	}, { // Test 5: Inland Chukotka, west of the antimeridian.
		Name: "chukotka west", Lat: 67.0, Lng: 175.0, WantOnLand: true,
	}, { // Test 6: Chukotka east of the antimeridian.
		Name: "chukotka east", Lat: 66.0, Lng: -172.0, WantOnLand: true,
	}, { // Test 7: Interior Antarctica, a ring that encloses the pole.
		Name: "antarctica", Lat: -80, Lng: 0, WantOnLand: true,
	}, { // Test 8: Chicago on the Lake Michigan shore.
		Name: "lakeshore", Lat: 41.88, Lng: -87.63, WantOnLand: true,
	}, { // Test 9: Mid Atlantic.
		Name: "mid atlantic", Lat: 0, Lng: -30, WantOnLand: false,
	}, { // Test 10: North Pacific.
		Name: "north pacific", Lat: 30, Lng: -150, WantOnLand: false,
	}, { // Test 11: Bering Sea, near the seam but at sea.
		Name: "bering sea", Lat: 58, Lng: -178, WantOnLand: false,
	}, { // Test 12: Southern Ocean, north of Antarctica.
		Name: "southern ocean", Lat: -55, Lng: 0, WantOnLand: false,
	}, { // Test 13: Arctic Ocean near the pole.
		Name: "arctic ocean", Lat: 88, Lng: 0, WantOnLand: false,
	}, { // Test 14: Just off the Dover coast, inside tolerance.
		Name: "off dover within tolerance", Lat: 51.08, Lng: 1.45, TolKM: 15, WantOnLand: true,
	}, { // Test 15: Same point without tolerance is at sea.
		Name: "off dover no tolerance", Lat: 51.08, Lng: 1.45, WantOnLand: false,
	}, { // Test 16: Anadyr sits on its estuary, which the 1:50m coast treats as sea.
		Name: "anadyr within tolerance", Lat: 64.73, Lng: 177.51, TolKM: 15, WantOnLand: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got := mask.OnLand(test.Lat, test.Lng, test.TolKM)
			if diff := cmp.Diff(test.WantOnLand, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestUnwrapRing pins the antimeridian unwrap and the polar closure.
func TestUnwrapRing(t *testing.T) {
	t.Parallel()
	tests := []struct {
		Name     string
		In       [][2]float64
		WantRing [][2]float64
	}{{ // Test 0: A ring that never nears the seam is unchanged.
		Name:     "plain",
		In:       [][2]float64{{0, 0}, {10, 0}, {10, 10}, {0, 0}},
		WantRing: [][2]float64{{0, 0}, {10, 0}, {10, 10}, {0, 0}},
	}, { // Test 1: A ring crossing the seam becomes contiguous past 180.
		Name:     "crosses seam",
		In:       [][2]float64{{170, 60}, {-170, 60}, {-170, 70}, {170, 70}, {170, 60}},
		WantRing: [][2]float64{{170, 60}, {190, 60}, {190, 70}, {170, 70}, {170, 60}},
	}, { // Test 2: A ring starting east of the seam shifts back into range.
		Name:     "starts east of seam",
		In:       [][2]float64{{-170, 60}, {170, 60}, {170, 70}, {-170, 70}, {-170, 60}},
		WantRing: [][2]float64{{190, 60}, {170, 60}, {170, 70}, {190, 70}, {190, 60}},
	}, { // Test 3: A ring that winds around the south pole closes through it.
		Name: "south polar",
		In:   [][2]float64{{-180, -70}, {-60, -70}, {60, -70}, {180, -70}},
		WantRing: [][2]float64{{-180, -70}, {-60, -70}, {60, -70}, {180, -70}, {180, -90},
			{-180, -90}, {-180, -70}},
	}, { // Test 4: A single point is returned as is.
		Name:     "single point",
		In:       [][2]float64{{5, 5}},
		WantRing: [][2]float64{{5, 5}},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			got := unwrapRing(test.In)
			if diff := cmp.Diff(test.WantRing, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

// TestLoadLandMaskErrors pins the load failures.
func TestLoadLandMaskErrors(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
		return p
	}
	tests := []struct {
		Name string
		Path string
		Want error
	}{{ // Test 0: Missing file.
		Name: "missing", Path: filepath.Join(dir, "nope.json"), Want: os.ErrNotExist,
	}, { // Test 1: Not JSON.
		Name: "bad json", Path: write("bad.json", "{"), Want: ErrLandMask,
	}, { // Test 2: No land object.
		Name: "no land", Path: write("noland.json", `{"objects":{}}`), Want: ErrLandMask,
	}, { // Test 3: Land object with no polygons.
		Name: "empty land", Path: write("empty.json", `{"objects":{"land":{"geometries":[]}}}`), Want: ErrLandMask,
	}, { // Test 4: Shipped file loads.
		Name: "shipped", Path: testLandMaskPath, Want: nil,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d %s", testNum, test.Name), func(t *testing.T) {
			t.Parallel()
			_, err := LoadLandMask(test.Path)
			if !errors.Is(err, test.Want) {
				t.Errorf("want %v, got %v", test.Want, err)
			}
			if test.Want == os.ErrNotExist && !errors.Is(err, ErrLandMask) {
				t.Errorf("want ErrLandMask wrapped, got %v", err)
			}
		})
	}
}
