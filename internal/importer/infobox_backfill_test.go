package importer

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"
)

func TestInfoboxParamExtraction(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In        string
		Names     []string
		WantValue string
		WantFound bool
	}{{ // Test 0: Simple single-line place value.
		In: "{{Infobox military conflict\n| place = [[Mohács]], Hungary\n" +
			"| result = Ottoman victory\n}}",
		Names:     []string{"place", "location"},
		WantValue: "[[Mohács]], Hungary",
		WantFound: true,
	}, { // Test 1: Multiline value runs until the next parameter pipe.
		In: "{{Infobox military conflict\n| place = Near [[Vienna]],\nArchduchy of Austria\n" +
			"| date = 1526\n}}",
		Names:     []string{"place"},
		WantValue: "Near [[Vienna]],\nArchduchy of Austria",
		WantFound: true,
	}, { // Test 2: Nested template pipes do not split the parameter.
		In: "{{Infobox military conflict\n" +
			"| date = 21 April 1526{{efn|Julian {{lang|la|calendarium}}}}\n}}",
		Names:     []string{"date"},
		WantValue: "21 April 1526{{efn|Julian {{lang|la|calendarium}}}}",
		WantFound: true,
	}, { // Test 3: Wiki link pipes do not split the parameter.
		In:        "{{Infobox military conflict\n| place = [[Panipat|Panipat, Haryana]], India\n}}",
		Names:     []string{"place"},
		WantValue: "[[Panipat|Panipat, Haryana]], India",
		WantFound: true,
	}, { // Test 4: Article without a military infobox yields nothing.
		In:        "Some prose. {{Infobox settlement\n| name = Vienna\n| coordinates = here\n}}",
		Names:     []string{"place"},
		WantValue: "",
		WantFound: false,
	}, { // Test 5: Location alias serves when place is absent.
		In:        "{{Infobox military conflict\n| location = [[Panipat]]\n}}",
		Names:     []string{"place", "location"},
		WantValue: "[[Panipat]]",
		WantFound: true,
	}, { // Test 6: Infobox battle variant is recognized.
		In:        "{{Infobox battle\n| place = [[Agincourt]]\n}}",
		Names:     []string{"place"},
		WantValue: "[[Agincourt]]",
		WantFound: true,
	}, { // Test 7: Parameter names match case-insensitively.
		In:        "{{Infobox Military Conflict\n| Place = [[Tours]]\n}}",
		Names:     []string{"place"},
		WantValue: "[[Tours]]",
		WantFound: true,
	}, { // Test 8: Infobox present but parameter missing.
		In:        "{{Infobox military conflict\n| result = Decisive victory\n}}",
		Names:     []string{"place"},
		WantValue: "",
		WantFound: false,
	}, { // Test 9: Ref markup inside a value is preserved raw for the cleaner.
		In:        "{{Infobox military conflict\n| date = 14 October 1066<ref>Howarth 1977</ref>\n}}",
		Names:     []string{"date"},
		WantValue: "14 October 1066<ref>Howarth 1977</ref>",
		WantFound: true,
	}, { // Test 10: Empty first name falls through to a populated alias.
		In:        "{{Infobox military conflict\n| place =\n| location = [[Tours]]\n}}",
		Names:     []string{"place", "location"},
		WantValue: "[[Tours]]",
		WantFound: true,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			var gotValue string
			var gotFound bool
			if box, ok := findMilitaryInfobox(test.In); ok {
				gotValue, gotFound = infoboxParam(box, test.Names...)
			}
			if gotFound != test.WantFound {
				t.Fatalf("found = %v, want %v", gotFound, test.WantFound)
			}
			if diff := cmp.Diff(test.WantValue, gotValue); diff != "" {
				t.Errorf("value mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestCleanInfoboxText(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult string
	}{{ // Test 0: Piped link keeps its label.
		In:         "[[Mohács|Mohács field]], Hungary",
		WantResult: "Mohács field, Hungary",
	}, { // Test 1: Plain link keeps its target.
		In:         "[[Mohács]], Hungary",
		WantResult: "Mohács, Hungary",
	}, { // Test 2: Ref elements drop entirely.
		In:         "14 October 1066<ref>Howarth, ''1066''</ref>",
		WantResult: "14 October 1066",
	}, { // Test 3: Self-closing refs drop.
		In:         "Near Hastings<ref name=\"how\" />, England",
		WantResult: "Near Hastings, England",
	}, { // Test 4: HTML comments drop.
		In:         "Panipat <!-- coordinates disputed --> , India",
		WantResult: "Panipat , India",
	}, { // Test 5: Nested templates drop as one unit.
		In:         "21 April 1526{{efn|Julian {{lang|la|calendarium}} note}}",
		WantResult: "21 April 1526",
	}, { // Test 6: Nowrap wrapper keeps its text.
		In:         "{{nowrap|21 April 1526}}",
		WantResult: "21 April 1526",
	}, { // Test 7: Lang wrapper keeps the text, drops the language code.
		In:         "{{lang|fr|Azincourt}}, France",
		WantResult: "Azincourt, France",
	}, { // Test 8: Line breaks become comma separators.
		In:         "Mohács<br />Kingdom of Hungary",
		WantResult: "Mohács, Kingdom of Hungary",
	}, { // Test 9: Entities decode and whitespace collapses.
		In:         "21&nbsp;April   1526\nHungary",
		WantResult: "21 April 1526 Hungary",
	}, { // Test 10: Start and end date templates render back to text.
		In:         "{{Start date|1914|10|29|df=y}} – {{End date|1918|11|11|df=y}}",
		WantResult: "29 October 1914 – 11 November 1918",
	}, { // Test 11: Day-less start date template renders month and year.
		In:         "{{start date|1526|4}}",
		WantResult: "April 1526",
	}, { // Test 12: Free-text start-date template passes its text through.
		In:         "{{start-date|November 1, 1918}}",
		WantResult: "November 1, 1918",
	}, { // Test 13: Bullet markers strip from multiline lists.
		In:         "* [[Mohács]]\n* Hungary",
		WantResult: "Mohács Hungary",
	}, { // Test 14: Stray edge punctuation trims.
		In:         "Mohács, Hungary,",
		WantResult: "Mohács, Hungary",
	}, { // Test 15: Unknown template drops even with named parameters.
		In:         "[[Verdun]]{{coord|49.20|5.38|display=inline}}, France",
		WantResult: "Verdun, France",
	}, { // Test 16: Empty value stays empty.
		In:         "",
		WantResult: "",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := cleanInfoboxText(test.In)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestParseCoordTemplateForms(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In      string
		WantLat float64
		WantLng float64
	}{{ // Test 0: Decimal degrees.
		In:      "{{coord|48.2082|16.3738|display=title}}",
		WantLat: 48.2082,
		WantLng: 16.3738,
	}, { // Test 1: Negative decimal longitude.
		In:      "{{Coord|39.8114|-77.2258|region:US|display=title}}",
		WantLat: 39.8114,
		WantLng: -77.2258,
	}, { // Test 2: Full degrees-minutes-seconds with hemispheres.
		In:      "{{coord|34|15|20.4|N|88|44|13.2|W|display=title}}",
		WantLat: 34.2556666667,
		WantLng: -88.7370,
	}, { // Test 3: Decimal degrees with hemisphere letters.
		In:      "{{coord|51.5074|N|0.1278|W}}",
		WantLat: 51.5074,
		WantLng: -0.1278,
	}, { // Test 4: Degrees and minutes without seconds.
		In:      "{{coord|45|30|S|170|30|E}}",
		WantLat: -45.5,
		WantLng: 170.5,
	}, { // Test 5: No coord template anywhere.
		In:      "Prose about a battle with {{cite book|title=X}} only.",
		WantLat: 0,
		WantLng: 0,
	}, { // Test 6: Coord template buried in article prose.
		In: "Intro text.\n{{Infobox military conflict\n|place=X\n}}\n" +
			"The site {{coord|10.5|-66.9}} today.",
		WantLat: 10.5,
		WantLng: -66.9,
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			gotLat, gotLng := parseCoordTemplate(test.In)
			opt := cmpopts.EquateApprox(0, 1e-6)
			if diff := cmp.Diff(test.WantLat, gotLat, opt); diff != "" {
				t.Errorf("lat mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantLng, gotLng, opt); diff != "" {
				t.Errorf("lng mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestParseInfoboxDate(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult backfillDate
		WantReason string
	}{{ // Test 0: Single day in DMY order.
		In:         "21 April 1526",
		WantResult: backfillDate{Display: "April 21, 1526", Start: "1526-04-21", Year: 1526},
	}, { // Test 1: Single day in MDY order.
		In:         "April 21, 1526",
		WantResult: backfillDate{Display: "April 21, 1526", Start: "1526-04-21", Year: 1526},
	}, { // Test 2: Month precision only.
		In:         "April 1526",
		WantResult: backfillDate{Display: "April 1526", Year: 1526},
	}, { // Test 3: Season passes through.
		In:         "Spring 1526",
		WantResult: backfillDate{Display: "Spring 1526", Year: 1526},
	}, { // Test 4: Bare year skips; the year column already covers it.
		In:         "1526",
		WantReason: "bare-year",
	}, { // Test 5: Same-month day range in DMY order.
		In:         "20–25 August 1526",
		WantResult: backfillDate{Display: "August 20–25, 1526", Start: "1526-08-20", Year: 1526},
	}, { // Test 6: Same-month day range in MDY order.
		In:         "August 20–25, 1526",
		WantResult: backfillDate{Display: "August 20–25, 1526", Start: "1526-08-20", Year: 1526},
	}, { // Test 7: Cross-month range with a shared year.
		In:         "26 May – 4 June 1940",
		WantResult: backfillDate{Display: "May 26 – June 4, 1940", Start: "1940-05-26", Year: 1940},
	}, { // Test 8: Comma-joined cross-month range.
		In:         "26 May, 4 June 1940",
		WantResult: backfillDate{Display: "May 26 – June 4, 1940", Start: "1940-05-26", Year: 1940},
	}, { // Test 9: Full range with the year repeated on both sides.
		In: "10 July 1940 – 31 October 1940",
		WantResult: backfillDate{
			Display: "July 10 – October 31, 1940", Start: "1940-07-10", Year: 1940,
		},
	}, { // Test 10: Full range across years keeps both years.
		In: "29 October 1914 – 30 October 1918",
		WantResult: backfillDate{
			Display: "October 29, 1914 – October 30, 1918",
			Start:   "1914-10-29", Year: 1914, EndYear: 1918,
		},
	}, { // Test 11: Month-year start with a day-precision end.
		In: "October 1914 – 11 July 1915",
		WantResult: backfillDate{
			Display: "October 1914 – July 11, 1915",
			Year:    1914, EndYear: 1915,
		},
	}, { // Test 12: Day-precision start with a month-year end.
		In: "11 July 1914 – October 1915",
		WantResult: backfillDate{
			Display: "July 11, 1914 – October 1915",
			Start:   "1914-07-11", Year: 1914, EndYear: 1915,
		},
	}, { // Test 13: Month range within one year.
		In:         "October – December 1526",
		WantResult: backfillDate{Display: "October – December 1526", Year: 1526},
	}, { // Test 14: Month range across years.
		In:         "October 1914 – July 1915",
		WantResult: backfillDate{Display: "October 1914 – July 1915", Year: 1914, EndYear: 1915},
	}, { // Test 15: BC dates skip; the DB's BC encoding is not uniform.
		In:         "Spring 71 BC",
		WantReason: "bc-date",
	}, { // Test 16: Unparseable text is counted, not guessed.
		In:         "sometime during the harvest",
		WantReason: "unparsed",
	}, { // Test 17: Empty input is unparsed.
		In:         "",
		WantReason: "unparsed",
	}, { // Test 18: Season with "of" connector.
		In:         "Winter of 1077",
		WantResult: backfillDate{Display: "Winter 1077", Year: 1077},
	}, { // Test 19: Sept abbreviation resolves to September.
		In:         "14 Sept 1862",
		WantResult: backfillDate{Display: "September 14, 1862", Start: "1862-09-14", Year: 1862},
	}, { // Test 20: ISO form parses directly.
		In:         "1526-04-21",
		WantResult: backfillDate{Display: "April 21, 1526", Start: "1526-04-21", Year: 1526},
	}, { // Test 21: Night-raid slash range reads as a day range.
		In:         "21/22 April 1526",
		WantResult: backfillDate{Display: "April 21–22, 1526", Start: "1526-04-21", Year: 1526},
	}, { // Test 22: MDY full range across years.
		In: "July 10, 1940 – October 31, 1941",
		WantResult: backfillDate{
			Display: "July 10, 1940 – October 31, 1941",
			Start:   "1940-07-10", Year: 1940, EndYear: 1941,
		},
	}, { // Test 23: Circa prefix strips down to a bare year.
		In:         "c. 1526",
		WantReason: "bare-year",
	}, { // Test 24: Trailing footnote text does not block the date.
		In:         "21 April 1526 (Julian calendar)",
		WantResult: backfillDate{Display: "April 21, 1526", Start: "1526-04-21", Year: 1526},
	}, { // Test 25: Rendered start and end date templates parse as a range.
		In: "29 October 1914 – 11 November 1918",
		WantResult: backfillDate{
			Display: "October 29, 1914 – November 11, 1918",
			Start:   "1914-10-29", Year: 1914, EndYear: 1918,
		},
	}, { // Test 26: Ordinal day suffix strips before parsing.
		In:         "21st April 1526",
		WantResult: backfillDate{Display: "April 21, 1526", Start: "1526-04-21", Year: 1526},
	}, { // Test 27: Word separator "to" reads as a range.
		In:         "20 to 25 August 1526",
		WantResult: backfillDate{Display: "August 20–25, 1526", Start: "1526-08-20", Year: 1526},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got, gotReason := parseInfoboxDate(test.In)
			if gotReason != test.WantReason {
				t.Fatalf("reason = %q, want %q", gotReason, test.WantReason)
			}
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestStripPlaceNoise(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult string
	}{{ // Test 0: Leading "near" strips.
		In:         "near Vienna",
		WantResult: "Vienna",
	}, { // Test 1: Stacked prepositions strip iteratively.
		In:         "off the coast of Crete",
		WantResult: "Crete",
	}, { // Test 2: Era qualifier strips.
		In:         "present-day Belgium",
		WantResult: "Belgium",
	}, { // Test 3: Clean place passes through.
		In:         "Mohács, Hungary",
		WantResult: "Mohács, Hungary",
	}, { // Test 4: Words containing a noise prefix are untouched.
		In:         "Inowrocław, Poland",
		WantResult: "Inowrocław, Poland",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := stripPlaceNoise(test.In)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestBuildPlaceQueries(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		InWar      string
		WantResult []string
	}{{ // Test 0: Single segment, no war country: one query.
		In:         "Mohács field",
		WantResult: []string{"Mohács field"},
	}, { // Test 1: Country in the last segment: first segment retries with it.
		In:         "Ypres, West Flanders, Belgium",
		WantResult: []string{"Ypres, West Flanders, Belgium", "Ypres, Belgium"},
	}, { // Test 2: Country elsewhere in text joins the last and first segments.
		In: "Verdun, France, near the Meuse",
		WantResult: []string{
			"Verdun, France, near the Meuse", "the Meuse, France", "Verdun, France",
		},
	}, { // Test 3: War naming a country adds the suffixed query.
		In:         "Ia Drang Valley",
		InWar:      "Vietnam War",
		WantResult: []string{"Ia Drang Valley", "Ia Drang Valley, Vietnam"},
	}, { // Test 4: Adjectival war name maps to its modern country.
		In:         "Cerro Corá",
		InWar:      "Paraguayan War",
		WantResult: []string{"Cerro Corá", "Cerro Corá, Paraguay"},
	}, { // Test 5: Leading noise strips before querying.
		In:         "near Vienna, Austria",
		WantResult: []string{"Vienna, Austria"},
	}, { // Test 6: Empty place yields no queries.
		In:         "",
		WantResult: nil,
	}, { // Test 7: Historical region maps to a modern-country retry.
		In: "Ctesiphon, Mesopotamia",
		WantResult: []string{
			"Ctesiphon, Mesopotamia", "Mesopotamia", "Ctesiphon, Iraq",
		},
	}, { // Test 8: French and Indian War maps to the United States.
		In:         "Fort Duquesne",
		InWar:      "French and Indian War",
		WantResult: []string{"Fort Duquesne", "Fort Duquesne, United States"},
	}, { // Test 9: Modern name inside a "(today X)" aside leads the queries.
		In: "Near Esc-Scebb (today Sabha), Libya",
		WantResult: []string{
			"Sabha, Libya", "Esc-Scebb, Libya",
		},
	}, { // Test 10: Country embedded in a historical last segment retries the
		// first segment against the bare country.
		In: "Chyhyryn, Right-bank Ukraine",
		WantResult: []string{
			"Chyhyryn, Right-bank Ukraine", "Chyhyryn, Ukraine",
		},
	}, { // Test 11: War country skipped when the place already names it.
		In:         "Hue, Vietnam",
		InWar:      "Vietnam War",
		WantResult: []string{"Hue, Vietnam"},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := buildPlaceQueries(test.In, test.InWar)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestCountryFromWar(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         string
		WantResult string
	}{{ // Test 0: Empty war yields nothing.
		In:         "",
		WantResult: "",
	}, { // Test 1: World wars name no single country.
		In:         "World War II",
		WantResult: "",
	}, { // Test 2: Country named outright.
		In:         "War in Afghanistan (2001–2021)",
		WantResult: "Afghanistan",
	}, { // Test 3: Adjectival fragment maps to the country.
		In:         "Mexican Revolution",
		WantResult: "Mexico",
	}, { // Test 4: Compound adjective picks the battleground country.
		In:         "Russo-Ukrainian War",
		WantResult: "Ukraine",
	}, { // Test 5: American Indian Wars resolve to the United States.
		In:         "American Indian Wars",
		WantResult: "United States",
	}, { // Test 6: French and Indian War is North American.
		In:         "French and Indian War",
		WantResult: "United States",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := countryFromWar(test.In)
			if diff := cmp.Diff(test.WantResult, got); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestNominatimAcceptable(t *testing.T) {
	t.Parallel()
	tests := []struct {
		In         nominatimResult
		InPlace    string
		WantLat    float64
		WantLng    float64
		WantReason string
	}{{ // Test 0: High importance accepts outright.
		In: nominatimResult{
			Lat: "45.9599", Lon: "18.6867", Importance: 0.55,
			DisplayName: "Mohács, Baranya, Hungary",
			BoundingBox: []string{"45.94", "45.98", "18.66", "18.71"},
		},
		InPlace: "Mohács field, Hungary",
		WantLat: 45.9599, WantLng: 18.6867,
	}, { // Test 1: Low importance rescued by a place token in the display name.
		In: nominatimResult{
			Lat: "19.9678", Lon: "-75.8339", Importance: 0.13,
			DisplayName: "Aguadores, Santiago de Cuba, Cuba",
			BoundingBox: []string{"19.94", "19.98", "-75.85", "-75.81"},
		},
		InPlace: "Aguadores river mouth",
		WantLat: 19.9678, WantLng: -75.8339,
	}, { // Test 2: Low importance with no token overlap is rejected.
		In: nominatimResult{
			Lat: "10.0", Lon: "20.0", Importance: 0.12,
			DisplayName: "Somewhere Else Entirely",
			BoundingBox: []string{"9.9", "10.1", "19.9", "20.1"},
		},
		InPlace:    "Mohács, Hungary",
		WantReason: "low-confidence",
	}, { // Test 3: Country-level bounding box is rejected despite importance.
		In: nominatimResult{
			Lat: "47.0", Lon: "19.0", Importance: 0.85,
			DisplayName: "Hungary",
			BoundingBox: []string{"45.7", "48.6", "16.1", "22.9"},
		},
		InPlace:    "Hungary",
		WantReason: "bbox-too-large",
	}, { // Test 4: Unparseable coordinates are rejected.
		In: nominatimResult{
			Lat: "not-a-number", Lon: "18.7", Importance: 0.9,
			DisplayName: "Mohács",
		},
		InPlace:    "Mohács",
		WantReason: "invalid-coord",
	}, { // Test 5: The 0,0 placeholder is rejected.
		In: nominatimResult{
			Lat: "0", Lon: "0", Importance: 0.9,
			DisplayName: "Null Island",
		},
		InPlace:    "Null Island",
		WantReason: "invalid-coord",
	}, { // Test 6: Missing bounding box still accepts on importance.
		In: nominatimResult{
			Lat: "45.9599", Lon: "18.6867", Importance: 0.4,
			DisplayName: "Mohács, Hungary",
		},
		InPlace: "Mohács",
		WantLat: 45.9599, WantLng: 18.6867,
	}, { // Test 7: Stopword tokens do not rescue a low-importance hit.
		In: nominatimResult{
			Lat: "10.0", Lon: "20.0", Importance: 0.1,
			DisplayName: "The Northern River District",
			BoundingBox: []string{"9.9", "10.1", "19.9", "20.1"},
		},
		InPlace:    "north of the river",
		WantReason: "low-confidence",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			gotLat, gotLng, gotReason := nominatimAcceptable(test.In, test.InPlace)
			if gotReason != test.WantReason {
				t.Fatalf("reason = %q, want %q", gotReason, test.WantReason)
			}
			opt := cmpopts.EquateApprox(0, 1e-9)
			if diff := cmp.Diff(test.WantLat, gotLat, opt); diff != "" {
				t.Errorf("lat mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantLng, gotLng, opt); diff != "" {
				t.Errorf("lng mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestBackfillDateTitle(t *testing.T) {
	t.Parallel()
	article := "{{Infobox military conflict\n| date = 21 April 1526<ref>chronicle</ref>\n" +
		"| place = [[Mohács]]\n}}"
	tests := []struct {
		In          string
		InHave      bool
		InBattles   []backfillBattle
		WantResult  []backfillDateUpdate
		WantsReason map[string]int
	}{{ // Test 0: Matching year writes display and start.
		In:     article,
		InHave: true,
		InBattles: []backfillBattle{
			{ID: "b1", Year: 1526},
		},
		WantResult: []backfillDateUpdate{
			{ID: "b1", Display: "April 21, 1526", Start: "1526-04-21"},
		},
		WantsReason: map[string]int{},
	}, { // Test 1: Year mismatch skips the battle.
		In:     article,
		InHave: true,
		InBattles: []backfillBattle{
			{ID: "b1", Year: 1527},
		},
		WantResult:  nil,
		WantsReason: map[string]int{"year-mismatch": 1},
	}, { // Test 2: Missing article counts per battle.
		In:     "",
		InHave: false,
		InBattles: []backfillBattle{
			{ID: "b1", Year: 1526}, {ID: "b2", Year: 1526},
		},
		WantResult:  nil,
		WantsReason: map[string]int{"no-article": 2},
	}, { // Test 3: Article without an infobox is counted.
		In:     "Just prose about a battle.",
		InHave: true,
		InBattles: []backfillBattle{
			{ID: "b1", Year: 1526},
		},
		WantResult:  nil,
		WantsReason: map[string]int{"no-infobox": 1},
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			sum := BackfillPipelineSummary{Rejected: map[string]int{}}
			got := backfillDateTitle(&sum, test.In, test.InHave, test.InBattles)
			if diff := cmp.Diff(test.WantResult, got, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("updates mismatch (-want +got):\n%s", diff)
			}
			if diff := cmp.Diff(test.WantsReason, sum.Rejected, cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("rejected mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
