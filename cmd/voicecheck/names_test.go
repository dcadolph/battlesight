package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/google/go-cmp/cmp/cmpopts"

	"github.com/dcadolph/battlesight/internal/voice"
)

func TestAnswerFields(t *testing.T) {
	t.Parallel()
	tests := []struct {
		WantFields []string
		In         string
	}{{ // Test 0: A CSV row splits into its fields.
		In: "n00001,Bakhmut,bˈɑːxmʊt,bˈɑːkmuːt", WantFields: []string{"n00001", "Bakhmut", "bˈɑːxmʊt", "bˈɑːkmuːt"},
	}, { // Test 1: A quoted reason keeps its comma.
		In:         `n00002,Murat,mjʊɹˈɑː,mjʊɹˈɑː,"Marshal of France, said the English way."`,
		WantFields: []string{"n00002", "Murat", "mjʊɹˈɑː", "mjʊɹˈɑː", "Marshal of France, said the English way."},
	}, { // Test 2: A Markdown table row splits on its bars.
		In: "| n00003 | Ney | nˈeɪ | nˈeɪ |", WantFields: []string{"n00003", "Ney", "nˈeɪ", "nˈeɪ"},
	}, { // Test 3: Backticks around a field are trimmed.
		In: "`n00004`,Zhukov,`ʒˈuːkɒf`,ʒˈuːkɑːf", WantFields: []string{"n00004", "Zhukov", "ʒˈuːkɒf", "ʒˈuːkɑːf"},
	}, { // Test 4: A code fence leaves one field, too few for a row.
		In: "```csv", WantFields: []string{"csv"},
	}, { // Test 5: A blank line is no row.
		In: "   ",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			if diff := cmp.Diff(test.WantFields, answerFields(test.In), cmpopts.EquateEmpty()); diff != "" {
				t.Errorf("fields mismatch (-want +got):\n%s", diff)
			}
		})
	}
}

func TestReadAnswers(t *testing.T) {
	t.Parallel()
	rows := map[string]nameRow{
		"n00001": {ID: "n00001", Name: "Bakhmut"},
		"n00002": {ID: "n00002", Name: "fleches", Spellings: []string{"flèches"}},
		"n00003": {ID: "n00003", Name: "Ney"},
	}
	pasted := strings.Join([]string{
		"Paste each ChatGPT answer below.",
		"Here are the readings:",
		"```csv",
		"id,name,british,american",
		"n00001,Bakhmut,bˈɑːkmʊt,bˈɑːkmuːt",
		"n00002,flèches,flˈɛʃ,flˈɛʃ",
		"n00003,Murat,mjʊɹˈɑː,mjʊɹˈɑː",
		"n00009,Lannes,lˈæn,lˈæn",
		"```",
		"n00001,Bakhmut,bˈɑːxmʊt,bˈɑːxmuːt",
		"Let me know if you need more.",
	}, "\n")
	path := filepath.Join(t.TempDir(), "answers.txt")
	if err := os.WriteFile(path, []byte(pasted), 0o600); err != nil {
		t.Fatal(err)
	}
	got, rejected, err := readAnswers(path, rows)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]answer{
		"n00001": {british: "bˈɑːxmʊt", american: "bˈɑːxmuːt"},
		"n00002": {british: "flˈɛʃ", american: "flˈɛʃ"},
	}
	if diff := cmp.Diff(want, got, cmp.AllowUnexported(answer{})); diff != "" {
		t.Errorf("answers mismatch (-want +got):\n%s", diff)
	}
	if rejected != 1 {
		t.Errorf("rejected: got %d, want 1 for the row whose name does not match its id", rejected)
	}
	none, _, err := readAnswers(filepath.Join(t.TempDir(), "missing.txt"), rows)
	if err != nil || len(none) != 0 {
		t.Errorf("missing file: got %v, %v, want no answers", none, err)
	}
}

func TestMerge(t *testing.T) {
	t.Parallel()
	rows := []nameRow{
		{ID: "n00001", Name: "Bakhmut"}, {ID: "n00002", Name: "Kutuzov"}, {ID: "n00003", Name: "Zhukov"},
		{ID: "n00004", Name: "Ney"}, {ID: "n00005", Name: "Listed"}, {ID: "n00006", Name: "Murat"},
		{ID: "n00007", Name: "Odd"},
	}
	names := voice.NameList{"Listed": {British: "lˈɪstɪd", American: "lˈɪstɪd", Writers: []string{"chatgpt"}}}
	answers := map[string]map[string]answer{
		"chatgpt": {
			"n00001": {british: "bˈɑːxmʊt", american: "bˈɑːkmuːt"},
			"n00002": {british: "kʊtˈuːzəf", american: "kʊtˈuːzɑːf"},
			"n00003": {british: "ʒˈuːkɒf", american: "ʒˈuːkɑːf"},
			"n00006": {british: "myʁˈa", american: "myʁˈa"},
			"n00007": {british: "ⁿda", american: "ⁿda"},
		},
		"gemini": {
			"n00001": {british: "/ˈbɑːx.mʊt/", american: "ˈbɑk.mut"},
			"n00002": {british: "kˈʊtuzɒf", american: "kˈʊtuzɑːf"},
			"n00006": {british: "mjʊɹˈɑː", american: "mjʊɹˈɑː"},
			"n00007": {british: "ⁿda", american: "ⁿda"},
		},
		settler: {
			"n00006": {british: "mjʊɹˈɑː", american: "mjʊɹˈɑː", reason: "Marshal of France, said the English way."},
		},
	}
	pending, result := merge(names, rows, answers)

	wantResult := mergeResult{listed: 1, agreed: 1, settled: 1, pending: 3, unanswered: 1}
	if diff := cmp.Diff(wantResult, result, cmp.AllowUnexported(mergeResult{})); diff != "" {
		t.Errorf("result mismatch (-want +got):\n%s", diff)
	}
	var pendingIDs []string
	for _, p := range pending {
		pendingIDs = append(pendingIDs, p.row.ID)
	}
	if diff := cmp.Diff([]string{"n00002", "n00003", "n00007"}, pendingIDs); diff != "" {
		t.Errorf("pending mismatch (-want +got):\n%s", diff)
	}
	if pending[1].b != (answer{}) {
		t.Errorf("Zhukov's second reading: got %+v, want empty for a writer that gave none", pending[1].b)
	}
	wantNames := voice.NameList{
		"Listed":  names["Listed"],
		"Bakhmut": {British: "bˈɑːxmʊt", American: "bˈɑːkmuːt", Writers: []string{"chatgpt", "gemini"}},
		"Murat": {British: "mjʊɹˈɑː", American: "mjʊɹˈɑː", Writers: []string{settler},
			Reason: "Marshal of France, said the English way."},
	}
	if diff := cmp.Diff(wantNames, names); diff != "" {
		t.Errorf("name list mismatch (-want +got):\n%s", diff)
	}
}

func TestExportImport(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	phases := []phaseText{{
		Battle: "bakhmut", Year: 2022, battleName: "Battle of Bakhmut",
		Speakable: "Wagner fighters push into Bakhmut from the east. Kutuzov is not here.",
		found:     []voice.Name{{Word: "Wagner"}, {Word: "Bakhmut"}, {Word: "Kutuzov"}},
	}, {
		Battle: "plataea", Year: -479, battleName: "Battle of Plataea",
		Speakable: "Mardonius falls.",
		found:     []voice.Name{{Word: "Mardonius"}, {Word: "Bakhmut"}},
	}}
	names := voice.NameList{"Wagner": {British: "vˈɑːɡnə", American: "vˈɑːɡnɚ", Writers: []string{"chatgpt"}}}
	if err := exportNames(dir, phases, names, 2); err != nil {
		t.Fatal(err)
	}
	index, err := loadIndex(dir)
	if err != nil {
		t.Fatal(err)
	}
	wantIndex := nameIndex{Rows: []nameRow{
		{ID: "n00001", Name: "Bakhmut", Context: "Wagner fighters push into Bakhmut from the east.",
			Battle: "Battle of Bakhmut", Year: "2022"},
		{ID: "n00002", Name: "Kutuzov", Context: "Kutuzov is not here.", Battle: "Battle of Bakhmut", Year: "2022"},
		{ID: "n00003", Name: "Mardonius", Context: "Mardonius falls.", Battle: "Battle of Plataea", Year: "479 BC"},
	}}
	if diff := cmp.Diff(wantIndex, index); diff != "" {
		t.Errorf("index mismatch (-want +got):\n%s", diff)
	}
	first, err := os.ReadFile(filepath.Join(dir, "battlesight-names-01.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(first), "Task: write how to pronounce 2 names") ||
		!strings.Contains(string(first), "This is batch 1 of 2.") ||
		!strings.HasSuffix(string(first), "Names:\nid,name,spelling,context,battle,year\n"+
			"n00001,Bakhmut,,Wagner fighters push into Bakhmut from the east.,Battle of Bakhmut,2022\n"+
			"n00002,Kutuzov,,Kutuzov is not here.,Battle of Bakhmut,2022\n") {
		t.Errorf("first batch:\n%s", first)
	}
	if _, err := os.Stat(filepath.Join(dir, "battlesight-names-03.txt")); err == nil {
		t.Error("a third batch was written for three names in batches of two")
	}

	answers := map[string]string{
		"chatgpt": "n00001,Bakhmut,bˈɑːxmʊt,bˈɑːkmuːt\nn00002,Kutuzov,kʊtˈuːzəf,kʊtˈuːzɑːf\n",
		"gemini":  "| n00001 | Bakhmut | ˈbɑːxmʊt | ˈbɑːkmuːt |\n| n00002 | Kutuzov | ˈkʊtuzɒf | ˈkʊtuzɑːf |\n",
	}
	for writer, text := range answers {
		if err := os.WriteFile(answerPath(dir, writer), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := importAnswers(dir, names, 2); err != nil {
		t.Fatal(err)
	}
	if _, ok := names["Bakhmut"]; !ok {
		t.Error("Bakhmut is not in the list after both writers agreed on it")
	}
	if _, ok := names["Kutuzov"]; ok {
		t.Error("Kutuzov is in the list although the writers put the stress apart")
	}
	settle, err := os.ReadFile(filepath.Join(dir, "battlesight-settle-01.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(string(settle), "n00002,Kutuzov,,Kutuzov is not here.,Battle of Bakhmut,2022,"+
		"kʊtˈuːzəf,kʊtˈuːzɑːf,kˈʊtuzɒf,kˈʊtuzɑːf\n") {
		t.Errorf("settle batch:\n%s", settle)
	}

	if err := exportNames(dir, phases, names, 2); err != nil {
		t.Fatal(err)
	}
	again, err := loadIndex(dir)
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff(wantIndex, again); diff != "" {
		t.Errorf("index changed on a second export (-want +got):\n%s", diff)
	}
	if _, err := os.Stat(filepath.Join(dir, "battlesight-names-02.txt")); err == nil {
		t.Error("a stale second batch survived when two names fit in one")
	}
}

func TestExcerpt(t *testing.T) {
	t.Parallel()
	long := "In the long and grinding struggle over the salt mines and the rail yards and the high ground " +
		"west of the town, Bakhmut holds through the winter while both armies pour in fresh men and guns."
	tests := []struct {
		WantExcerpt string
		Text        string
		Word        string
	}{{ // Test 0: The sentence that holds the word is returned.
		Text: "Wagner attacks. Bakhmut holds. Then winter.", Word: "Bakhmut", WantExcerpt: "Bakhmut holds.",
	}, { // Test 1: A long sentence is cut to the window around the word.
		Text: long, Word: "Bakhmut",
		WantExcerpt: "over the salt mines and the rail yards and the high ground west of the town, " +
			"Bakhmut holds through the winter while both armies pour in fresh men and guns.",
	}, { // Test 2: A word not in the text gives nothing.
		Text: "Wagner attacks.", Word: "Bakhmut",
	}}
	for testNum, test := range tests {
		t.Run(fmt.Sprintf("test %d", testNum), func(t *testing.T) {
			t.Parallel()
			got := excerpt(test.Text, test.Word)
			if diff := cmp.Diff(test.WantExcerpt, got); diff != "" {
				t.Errorf("excerpt mismatch (-want +got):\n%s", diff)
			}
			if n := len([]rune(got)); n > maxContext {
				t.Errorf("excerpt has %d characters, more than %d", n, maxContext)
			}
		})
	}
}
