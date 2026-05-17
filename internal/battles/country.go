package battles

import (
	"sort"
	"strings"
)

// countryPattern groups several substrings that, when present in a side
// description, attribute the side to the named present-day country. Patterns
// are matched after lower-casing the side string. The order of countries in
// the dispatcher below is deliberate: more specific phrases (e.g. "soviet
// union") are checked before broader ones (e.g. "russian") so a Cold War
// belligerent does not also accrue a tsarist-era label.
type countryPattern struct {
	Name     string
	Phrases  []string
}

// countryPatterns drives the side-to-country mapping. Each entry is matched
// independently against the lower-cased side string; a side may be attributed
// to more than one country (e.g. an "Allied" entry that names several).
var countryPatterns = []countryPattern{
	{Name: "United States", Phrases: []string{
		"united states", "u.s. army", "u.s. navy", "u.s. marine", "u.s.a.",
		"usa", "americans", "american army", "american navy",
		"american expeditionary", "american forces",
		"confederate states", "confederacy", "union army", "union forces",
	}},
	{Name: "United Kingdom", Phrases: []string{
		"united kingdom", "great britain", "british empire", "british army",
		"british indian", "royal navy", "royal air force", " raf ", " bef ",
		"kingdom of england", "english fleet", "scottish ", " welsh ",
		"anglo-", "british ", " britain", " england", "english (",
	}},
	{Name: "Germany", Phrases: []string{
		"nazi germany", "third reich", "wehrmacht", "german empire",
		"weimar republic", "imperial germany", "afrika korps", "luftwaffe",
		"kriegsmarine", "kingdom of prussia", "prussian ", " prussia",
		"germany", "german ",
	}},
	{Name: "Russia", Phrases: []string{
		"soviet union", "u.s.s.r.", "ussr", "red army", "soviet ",
		"bolshevik", "russian empire", "russian federation", "russian ",
		" russia", "imperial russia", "tsardom", "muscovy", "muscovite",
	}},
	{Name: "France", Phrases: []string{
		"french republic", "kingdom of france", "vichy france", "napoleonic",
		"free french", " france", "french ", "gauls", "gaul ",
	}},
	{Name: "Italy", Phrases: []string{
		"kingdom of italy", "italian republic", "italy", "italian ",
	}},
	{Name: "Rome", Phrases: []string{
		"roman republic", "roman empire", "byzantine empire", "eastern roman",
		" rome ", "roman ", " romans",
	}},
	{Name: "Spain", Phrases: []string{
		"spanish empire", "kingdom of spain", "crown of castile", " castile",
		"spain", "spanish ",
	}},
	{Name: "Portugal", Phrases: []string{"portugal", "portuguese "}},
	{Name: "Netherlands", Phrases: []string{
		"netherlands", "dutch ", "dutch republic", "united provinces",
		" holland", "batavian",
	}},
	{Name: "Belgium", Phrases: []string{"belgium", "belgian "}},
	{Name: "Poland", Phrases: []string{
		"poland", "polish ", "polish-lithuanian", "commonwealth of poland",
	}},
	{Name: "Ukraine", Phrases: []string{
		"ukraine", "ukrainian ", "armed forces of ukraine",
	}},
	{Name: "Japan", Phrases: []string{
		"empire of japan", "imperial japan", "imperial japanese",
		"japan", "japanese ",
	}},
	{Name: "China", Phrases: []string{
		"people's republic of china", "republic of china",
		"qing dynasty", "ming dynasty", "han dynasty", "tang dynasty",
		"song dynasty", "china", "chinese ",
	}},
	{Name: "Korea", Phrases: []string{
		"north korea", "south korea", "dprk", "republic of korea",
		"joseon", "goguryeo", "korea", "korean ",
	}},
	{Name: "Vietnam", Phrases: []string{
		"viet cong", "viet minh", "north vietnam", "south vietnam",
		"people's army of vietnam", "nva ", "vietnam", "vietnamese ",
	}},
	{Name: "India", Phrases: []string{
		"british indian", "mughal", "maratha", "mauryan", "india",
		"indian ",
	}},
	{Name: "Pakistan", Phrases: []string{"pakistan", "pakistani "}},
	{Name: "Afghanistan", Phrases: []string{
		"afghanistan", "afghan ", "taliban", "northern alliance",
		"mujahideen",
	}},
	{Name: "Iran", Phrases: []string{
		"islamic republic of iran", "iran", "iranian ", "persia",
		"persian ", "achaemenid", "sassanid", "safavid", "qajar",
	}},
	{Name: "Iraq", Phrases: []string{
		"iraq", "iraqi ", "baathist iraq", "abbasid",
	}},
	{Name: "Syria", Phrases: []string{
		"syrian arab army", "ba'athist syria", "arab republic of syria",
		"syria", "syrian ", "isis", "islamic state", "isil", "daesh",
	}},
	{Name: "Israel", Phrases: []string{
		"israel defense forces", " idf ", "kingdom of israel", "israel",
		"israeli ",
	}},
	{Name: "Palestine", Phrases: []string{
		"palestine", "palestinian ", "hamas", "plo ", "fatah",
	}},
	{Name: "Lebanon", Phrases: []string{"lebanon", "lebanese ", "hezbollah"}},
	{Name: "Egypt", Phrases: []string{
		"egypt", "egyptian ", "ptolemaic", "mamluk", "fatimid", "ayyubid",
	}},
	{Name: "Turkey", Phrases: []string{
		"ottoman", "republic of turkey", "sublime porte", "turkey",
		"turkish ",
	}},
	{Name: "Greece", Phrases: []string{
		"hellenic", "athens", "athenian ", "sparta", "spartan ",
		"macedonia", "macedonian ", "thebes", "greece", "greek ",
	}},
	{Name: "Austria", Phrases: []string{
		"austria-hungary", "austrian empire", "habsburg",
		"holy roman empire", "austria", "austrian ",
	}},
	{Name: "Hungary", Phrases: []string{"hungary", "hungarian ", "magyar"}},
	{Name: "Serbia", Phrases: []string{
		"yugoslavia", "yugoslav ", "kingdom of serbia", "serbia",
		"serbian ",
	}},
	{Name: "Bulgaria", Phrases: []string{
		"kingdom of bulgaria", "bulgaria", "bulgarian ",
	}},
	{Name: "Romania", Phrases: []string{
		"wallachia", "moldavia", "romania", "romanian ",
	}},
	{Name: "Finland", Phrases: []string{"finland", "finnish "}},
	{Name: "Norway", Phrases: []string{"norway", "norwegian ", "norse "}},
	{Name: "Sweden", Phrases: []string{
		"kingdom of sweden", "sweden", "swedish ",
	}},
	{Name: "Denmark", Phrases: []string{
		"kingdom of denmark", "denmark", "danish ",
	}},
	{Name: "Canada", Phrases: []string{
		"royal canadian", "canada", "canadian ",
	}},
	{Name: "Australia", Phrases: []string{
		"royal australian", "anzac", "anzacs", "australia", "australian ",
	}},
	{Name: "New Zealand", Phrases: []string{
		"new zealand", "new zealanders",
	}},
	{Name: "Mexico", Phrases: []string{
		"aztec ", "mexica", "mexico", "mexican ",
	}},
	{Name: "Argentina", Phrases: []string{
		"argentina", "argentine ", "argentinian ",
	}},
	{Name: "Brazil", Phrases: []string{"brazil", "brazilian "}},
	{Name: "South Africa", Phrases: []string{
		"south africa", "south african ", "boer", "transvaal",
	}},
	{Name: "Ethiopia", Phrases: []string{
		"ethiopia", "ethiopian ", "abyssinia", "abyssinian ",
	}},
	{Name: "Sudan", Phrases: []string{
		"sudan", "sudanese ", "rapid support forces", " saf ",
	}},
	{Name: "Somalia", Phrases: []string{
		"somalia", "somali ", "al-shabaab", "al shabaab",
	}},
	{Name: "Libya", Phrases: []string{
		"libya", "libyan ", "gaddafi", "qaddafi",
	}},
	{Name: "Yemen", Phrases: []string{
		"yemen", "yemeni ", "houthi", "ansar allah",
	}},
	{Name: "Saudi Arabia", Phrases: []string{"saudi arabia", "saudi "}},
	{Name: "Armenia", Phrases: []string{"armenia", "armenian "}},
	{Name: "Azerbaijan", Phrases: []string{
		"azerbaijan", "azerbaijani ", "azeri ",
	}},
	{Name: "Mongolia", Phrases: []string{
		"mongol ", "mongols", "mongolia", "golden horde", "ilkhanate",
		"yuan dynasty",
	}},
}

// canonCountriesFromSide returns the canonical present-day countries inferred
// from a freeform side description. The result is stable and de-duplicated,
// and an empty slice means no recognised country was found.
func canonCountriesFromSide(side string) []string {
	if side == "" {
		return nil
	}
	s := " " + strings.ToLower(side) + " "
	var found []string
	for _, pat := range countryPatterns {
		for _, phrase := range pat.Phrases {
			if strings.Contains(s, phrase) {
				found = append(found, pat.Name)
				break
			}
		}
	}
	return found
}

// rankCountriesForWar accepts the parallel lists of side descriptions for
// every battle of a given war and returns the top participating countries by
// frequency. The returned slice is sorted by descending count and truncated
// to maxCount. Each country is counted at most once per battle.
func rankCountriesForWar(sidesByBattle [][]string, maxCount int) []string {
	tally := map[string]int{}
	for _, sides := range sidesByBattle {
		seen := map[string]bool{}
		for _, side := range sides {
			for _, c := range canonCountriesFromSide(side) {
				if seen[c] {
					continue
				}
				seen[c] = true
				tally[c]++
			}
		}
	}
	type entry struct {
		Name  string
		Count int
	}
	out := make([]entry, 0, len(tally))
	for name, count := range tally {
		out = append(out, entry{name, count})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	if maxCount > 0 && len(out) > maxCount {
		out = out[:maxCount]
	}
	names := make([]string, 0, len(out))
	for _, e := range out {
		names = append(names, e.Name)
	}
	return names
}
