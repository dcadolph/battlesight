package voice

import (
	"fmt"
	"testing"

	"github.com/google/go-cmp/cmp"
)

func TestSpeakable(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantResult string
		In         string
	}{{ // Test 0: Plain prose is unchanged.
		In: "Lines meet near the center of the field.", WantResult: "Lines meet near the center of the field.",
	}, { // Test 1: Wiki markup and flag image debris go.
		In:         "'''Vladimir Putin''' and 25pxShah [[Kingdom of France|France]] border=no Flag_of_Russia.svg",
		WantResult: "Vladimir Putin and Shah France",
	}, { // Test 2: A bracketed note goes and a prose aside reads as an aside.
		In:         "Faik Pasha (KIA) leads the velites (light infantry) forward.",
		WantResult: "Faik Pasha leads the velites, light infantry, forward.",
	}, { // Test 3: A bracketed place name reads as an aside.
		In: "Hill 304 (Dead Man's Hill) falls.", WantResult: "Hill 304, Dead Man's Hill, falls.",
	}, { // Test 4: Dates in brackets and glosses in another script go.
		In:         "Republic of China (1912–1949) and Wu Dinggui (吴定规) and Wei Gang（魏刚",
		WantResult: "Republic of China and Wu Dinggui and Wei Gang",
	}, { // Test 5: Letters outside English fold to their English base.
		In: "Trưởng, Władysław, Hōjō, Blücher, and Ğazi", WantResult: "Truong, Wladyslaw, Hojo, Blucher, and Gazi",
	}, { // Test 6: Cyrillic letters, alone or as look-alikes inside a Latin name, read in Latin.
		In: "Попов and Alexandru Cӑlinescu and Кiev", WantResult: "Popov and Alexandru Calinescu and Kiev",
	}, { // Test 7: Abbreviations spell out.
		In: "Lt. Gen. Ney, Maj. Gen. Smith, and St. Vith", WantResult: "Lieutenant General Ney, Major " +
			"General Smith, and Saint Vith",
	}, { // Test 8: Rank codes before a name spell out, and machine guns stay.
		In: "LTC William Weise and MG enfilade", WantResult: "Lieutenant Colonel William Weise and MG enfilade",
	}, { // Test 9: Initialisms the voice misreads.
		In: "IS fighters and UKGBI troops", WantResult: "Islamic State fighters and United Kingdom troops",
	}, { // Test 10: Symbols.
		In: "~5,000 men, 40% losses, −37 °C, Sauk/Meskwaki, D+7", WantResult: "about 5,000 men, 40 " +
			"percent losses, minus 37 degrees Celsius, Sauk and Meskwaki, D plus 7",
	}, { // Test 11: Years, rulers, and corps together.
		In: "In 1632 Louis XIV sends VI Corps.", WantResult: "In sixteen thirty-two Louis the Fourteenth " +
			"sends Sixth Corps.",
	}, { // Test 12: An en dash between words joins them, and one between clauses pauses.
		In: "Polish–Lithuanian forces – tired – hold.", WantResult: "Polish-Lithuanian forces, tired, hold.",
	}, { // Test 13: A comment cut short goes.
		In: "6th Army:<! commands", WantResult: "6th Army commands",
	}, { // Test 14: A name cut short keeps its ellipsis for the check.
		In: "Polish–Lithuanian Commonw… faces Sweden.", WantResult: "Polish-Lithuanian Commonw… faces Sweden.",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantResult, Speakable(test.In)); diff != "" {
				t.Errorf("mismatch (-want +got):\n%s", diff)
			}
		})
	}
}
