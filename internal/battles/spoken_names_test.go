package battles

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

// testFlagNames is a flag list built the way the server builds it, from catalog side names.
func testFlagNames(t *testing.T) FlagNames {
	t.Helper()
	return NewFlagNames([]string{
		"Kingdom of France", "Holy Roman Empire", "Russian Empire", "Ottoman Empire",
		"United Kingdom of Great Britain and Ireland", "Philippines", "Nazi Germany", "USA",
		"Duke of Burgundy", "Saladin", "Yanhuang tribe",
	})
}

func TestNewFlagNames(t *testing.T) {
	t.Parallel()
	got := testFlagNames(t).names
	want := []string{
		"United Kingdom of Great Britain and Ireland", "United Kingdom of Great Britain",
		"Holy Roman Empire", "Kingdom of France", "Ottoman Empire", "Russian Empire", "Nazi Germany",
		"Philippines", "Ireland", "USA",
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Errorf("mismatch (-want +got):\n%s", diff)
	}
}

func TestSpokenName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult string
	}{{ // Test 0: A plain name.
		In: "Kingdom of France", WantResult: "Kingdom of France",
	}, { // Test 1: A long name stays whole.
		In: "Polish–Lithuanian Commonwealth", WantResult: "Polish–Lithuanian Commonwealth",
	}, { // Test 2: Unknown is no name.
		In: "Unknown", WantResult: "",
	}, { // Test 3: An unknown with a note is no name.
		In: "Unknown (not mentioned in the history record)", WantResult: "",
	}, { // Test 4: A name repeated around a note is said once.
		In: "Republic of China (1912–49) Republic of China", WantResult: "Republic of China",
	}, { // Test 5: A dated flag caption goes.
		In: "Flag of Poland (1927–1980), Second Polish Republic", WantResult: "Second Polish Republic",
	}, { // Test 6: A supporters label reads as words.
		In: "Iraq Supported by: Iran", WantResult: "Iraq, supported by Iran",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, spokenName(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestSpokenCommanders(t *testing.T) {
	t.Parallel()
	flags := testFlagNames(t)
	tests := []struct {
		In         string
		Sides      []Side
		WantResult []string
	}{{ // Test 0: Flags before each name go.
		In:         "Kingdom of France Louis de Soissons, Holy Roman Empire Raimondo Montecuccoli",
		WantResult: []string{"Louis de Soissons", "Raimondo Montecuccoli"},
	}, { // Test 1: A flag code goes.
		In: "USA Douglas MacArthur, KOR Chung Il-kwon", WantResult: []string{"Douglas MacArthur", "Chung Il-kwon"},
	}, { // Test 2: Names run together by flags split apart.
		In:         "Russian Empire Yevgeni Alekseyev Russian Empire Nikolay Orlov",
		WantResult: []string{"Yevgeni Alekseyev", "Nikolay Orlov"},
	}, { // Test 3: A flag after a name goes, and a ruler before a flag stays.
		In:         "Ottoman Empire Mahmud II Ottoman Empire Abdulmecid I United Kingdom of Great Britain and Ireland Robert Stopford",
		WantResult: []string{"Mahmud II", "Abdulmecid I", "Robert Stopford"},
	}, { // Test 4: A flag mid-name splits two names.
		In:         "Roseller Barrientos Jr. Philippines Ibrahim Macadato",
		WantResult: []string{"Roseller Barrientos Jr.", "Ibrahim Macadato"},
	}, { // Test 5: A place after "of" is part of the name.
		In: "Archduke Eugen of Austria, Leo I of Galicia", WantResult: []string{"Archduke Eugen of Austria", "Leo I of Galicia"},
	}, { // Test 6: Unknown names and headings go.
		In: "Land:, unknown, Unknown Chu commander, George Cockburn", WantResult: []string{"George Cockburn"},
	}, { // Test 7: A note in brackets stays with its name.
		In:         "Faik Pasha (KIA), Mustafa Kemal (SDF, YPJ overall)",
		WantResult: []string{"Faik Pasha (KIA)", "Mustafa Kemal (SDF, YPJ overall)"},
	}, { // Test 8: Flag image debris goes.
		In: "25pxShah Mansur, Flag of the Cossack Hetmanat| Ivan Bugay", WantResult: []string{"Shah Mansur", "Ivan Bugay"},
	}, { // Test 9: A state name no list holds goes.
		In: "Mongolian People's Republic Bataar Enkhjargal", WantResult: []string{"Bataar Enkhjargal"},
	}, { // Test 10: The battle's own side name goes, a title stays.
		In: "Yanhuang tribe Huangdi, Duke of Burgundy", Sides: []Side{{Name: "Yanhuang tribe"}},
		WantResult: []string{"Huangdi", "Duke of Burgundy"},
	}, { // Test 11: A name in another script alone is dropped.
		In: "Li Guang, 公孫賀", WantResult: []string{"Li Guang"},
	}, { // Test 12: A crown prince keeps his title.
		In: "Crown Prince William", WantResult: []string{"Crown Prince William"},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			side := Side{Commander: test.In}
			got := spokenCommanders(side, Battle{Sides: append(test.Sides, side)}, flags)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestJoinNames(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         []string
		WantResult string
		WantVerb   string
	}{{ // Test 0: No names.
		WantResult: "", WantVerb: "commands",
	}, { // Test 1: One name takes the singular verb.
		In: []string{"Ney"}, WantResult: "Ney", WantVerb: "commands",
	}, { // Test 2: Two names.
		In: []string{"Ney", "Murat"}, WantResult: "Ney and Murat", WantVerb: "command",
	}, { // Test 3: Three names take a serial comma.
		In: []string{"Ney", "Murat", "Davout"}, WantResult: "Ney, Murat, and Davout", WantVerb: "command",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, joinNames(test.In)); diff != "" {
				t.Errorf("names mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantVerb, verbFor(test.In, "commands", "command")); diff != "" {
				t.Errorf("verb mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
