package main

import (
	"bytes"
	_ "embed"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"text/template"
	"unicode/utf8"

	"github.com/dcadolph/battlesight/internal/voice"
)

const (
	// indexFile names the file that keeps every name sent out, by id.
	indexFile = "battlesight-names-index.json"
	// writePrefix starts the file name of each batch for the writers.
	writePrefix = "battlesight-names-"
	// settlePrefix starts the file name of each batch of disagreements.
	settlePrefix = "battlesight-settle-"
	// answerPrefix starts the file name of each answer file.
	answerPrefix = "battlesight-answers-"
	// settler names the answer file for settled disagreements.
	settler = "settle"
	// maxContext is the most characters of narration a batch row shows.
	maxContext = 160
)

// writers lists the writers whose answers the import reads, in the order their readings are offered
// as A and B in a settle batch.
var writers = []string{"chatgpt", "gemini"}

// answerHeaders gives the first line of each answer file, which tells the owner what to paste.
var answerHeaders = map[string]string{
	"chatgpt": "Paste each ChatGPT answer below, in any order. Only lines that start with a name id are read.",
	"gemini":  "Paste each Gemini answer below, in any order. Only lines that start with a name id are read.",
	settler:   "Paste each answer to a settle batch below, in any order. Only lines that start with a name id are read.",
}

//go:embed prompts.txt
var promptText string

// prompts holds the prompt templates that open each batch.
var prompts = template.Must(template.New("prompts").Parse(promptText))

// promptData fills a prompt template.
type promptData struct {
	// Count is the number of names in the batch.
	Count int
	// Batch is the batch's number, counting from one.
	Batch int
	// Total is the number of batches.
	Total int
	// Symbols lists the symbols a reading may use.
	Symbols string
}

// nameRow is one name sent out to the writers.
type nameRow struct {
	// ID identifies the name across batches and answers. It never changes once given.
	ID string `json:"id"`
	// Name is the name as the speakable text spells it.
	Name string `json:"name"`
	// Spellings lists its source spellings when one differs from it.
	Spellings []string `json:"spellings,omitempty"`
	// Context is a short excerpt of the narration where it first appears.
	Context string `json:"context"`
	// Battle is the battle where it first appears.
	Battle string `json:"battle"`
	// Year is that battle's year, with BC for a year before the common era.
	Year string `json:"year"`
}

// nameIndex keeps every name sent out, in the order the ids were given.
type nameIndex struct {
	// Rows lists the names.
	Rows []nameRow `json:"rows"`
}

// answer is one writer's readings for one name.
type answer struct {
	// british is the reading for the British voice as the writer wrote it.
	british string
	// american is the reading for the American voice as the writer wrote it.
	american string
	// reason is the settler's one-line reason, empty for a writer.
	reason string
}

// settleRow is one name the writers disagreed on, with both readings in the voice's notation.
type settleRow struct {
	// row is the name.
	row nameRow
	// a holds the first writer's readings, empty when it gave none.
	a answer
	// b holds the second writer's readings, empty when it gave none.
	b answer
}

// mergeResult counts what an import did with each name in the index.
type mergeResult struct {
	// listed counts names the list already held.
	listed int
	// agreed counts names whose writers agreed in both voices.
	agreed int
	// settled counts names taken from the settled answers.
	settled int
	// pending counts names sent to be settled.
	pending int
	// unanswered counts names no writer answered.
	unanswered int
}

// exportNames writes the names the list lacks to dir, an existing directory, as batches of at
// most batchSize, each a prompt followed by its rows. A name keeps the id it was first given.
func exportNames(dir string, phases []phaseText, names voice.NameList, batchSize int) error {
	if batchSize < 1 {
		return fmt.Errorf("%w: batch size %d", errNames, batchSize)
	}
	index, err := loadIndex(dir)
	if err != nil {
		return err
	}
	at := make(map[string]int, len(index.Rows))
	for i, row := range index.Rows {
		at[row.Name] = i
	}
	var missing []nameRow
	for _, row := range missingNames(phases, names) {
		if i, ok := at[row.Name]; ok {
			row.ID = index.Rows[i].ID
			index.Rows[i] = row
		} else {
			row.ID = fmt.Sprintf("n%05d", len(index.Rows)+1)
			at[row.Name] = len(index.Rows)
			index.Rows = append(index.Rows, row)
		}
		missing = append(missing, row)
	}
	if err := saveIndex(dir, index); err != nil {
		return err
	}
	records := make([][]string, len(missing))
	for i, row := range missing {
		records[i] = rowRecord(row)
	}
	header := []string{"id", "name", "spelling", "context", "battle", "year"}
	total, err := writeBatches(dir, writePrefix, "write", header, records, batchSize)
	if err != nil {
		return err
	}
	for _, w := range writers {
		if err := ensureAnswerFile(dir, w); err != nil {
			return err
		}
	}
	fmt.Fprintf(os.Stderr, "names without a reading: %d, in %d batches in %s\n", len(missing), total, dir)
	return nil
}

// missingNames returns the names the phases speak that the list lacks, in order of first
// appearance, each with the narration and battle where it first appears.
func missingNames(phases []phaseText, names voice.NameList) []nameRow {
	var rows []nameRow
	seen := map[string]bool{}
	for _, line := range phases {
		for _, name := range line.found {
			if _, ok := names[name.Word]; ok || seen[name.Word] {
				continue
			}
			seen[name.Word] = true
			rows = append(rows, nameRow{
				Name: name.Word, Spellings: name.Spellings, Context: excerpt(line.Speakable, name.Word),
				Battle: line.battleName, Year: yearText(line.Year),
			})
		}
	}
	return rows
}

// importAnswers reads the answer files in dir, adds to the list every name the writers agreed on
// or a settler decided, and writes the names still in dispute to dir as settle batches.
func importAnswers(dir string, names voice.NameList, batchSize int) error {
	index, err := loadIndex(dir)
	if err != nil {
		return err
	}
	if len(index.Rows) == 0 {
		return fmt.Errorf("%w: no %s in %s, write the batches first", errNames, indexFile, dir)
	}
	byID := make(map[string]nameRow, len(index.Rows))
	for _, row := range index.Rows {
		byID[row.ID] = row
	}
	answers := map[string]map[string]answer{}
	for _, w := range append(append([]string{}, writers...), settler) {
		got, rejected, err := readAnswers(answerPath(dir, w), byID)
		if err != nil {
			return err
		}
		answers[w] = got
		fmt.Fprintf(os.Stderr, "%s answers: %d", w, len(got))
		if rejected > 0 {
			fmt.Fprintf(os.Stderr, ", %d rows refused for a name that does not match its id", rejected)
		}
		fmt.Fprintln(os.Stderr)
	}
	pending, result := merge(names, index.Rows, answers)
	records := make([][]string, len(pending))
	for i, p := range pending {
		records[i] = append(rowRecord(p.row), p.a.british, p.a.american, p.b.british, p.b.american)
	}
	header := []string{"id", "name", "spelling", "context", "battle", "year",
		"a_british", "a_american", "b_british", "b_american"}
	total, err := writeBatches(dir, settlePrefix, settler, header, records, batchSize)
	if err != nil {
		return err
	}
	if len(pending) > 0 {
		if err := ensureAnswerFile(dir, settler); err != nil {
			return err
		}
	}
	fmt.Fprintf(os.Stderr, "already listed %d, agreed %d, settled %d, to settle %d in %d batches, unanswered %d\n",
		result.listed, result.agreed, result.settled, result.pending, total, result.unanswered)
	return nil
}

// merge adds a list entry for every name the writers agreed on in both voices or a settler decided,
// and returns the names still in dispute. A reading counts only when it holds the voice's symbols
// alone once normalized.
func merge(names voice.NameList, rows []nameRow, answers map[string]map[string]answer) ([]settleRow, mergeResult) {
	var pending []settleRow
	var result mergeResult
	for _, row := range rows {
		if _, ok := names[row.Name]; ok {
			result.listed++
			continue
		}
		if s, ok := answers[settler][row.ID]; ok {
			if entry, valid := entryFrom(row, s, settler); valid {
				entry.Reason = strings.TrimSpace(s.reason)
				names[row.Name] = entry
				result.settled++
				continue
			}
		}
		a, okA := answers[writers[0]][row.ID]
		b, okB := answers[writers[1]][row.ID]
		if !okA && !okB {
			result.unanswered++
			continue
		}
		entryA, validA := entryFrom(row, a, writers[0])
		entryB, validB := entryFrom(row, b, writers[1])
		if validA && validB && voice.ReadingsAgree(entryA.British, entryB.British) &&
			voice.ReadingsAgree(entryA.American, entryB.American) {
			entryA.Writers = append([]string{}, writers...)
			names[row.Name] = entryA
			result.agreed++
			continue
		}
		pending = append(pending, settleRow{
			row: row,
			a:   answer{british: entryA.British, american: entryA.American},
			b:   answer{british: entryB.British, american: entryB.American},
		})
		result.pending++
	}
	return pending, result
}

// entryFrom builds a list entry from one answer, normalized to the voice's notation, and reports
// whether both readings are present and hold the voice's symbols alone.
func entryFrom(row nameRow, a answer, writer string) (voice.Entry, bool) {
	british, outsideBritish := voice.NormalizeReading(a.british)
	american, outsideAmerican := voice.NormalizeReading(a.american)
	entry := voice.Entry{British: british, American: american, Spellings: row.Spellings, Writers: []string{writer}}
	valid := british != "" && american != "" && len(outsideBritish) == 0 && len(outsideAmerican) == 0
	return entry, valid
}

// readAnswers reads a pasted answer file and returns the answers by id, with the count of rows
// refused because their name does not match their id. A line counts only when it is a row that
// starts with a known id, so pasted chatter, code fences, and headers do no harm. A later row for
// the same id wins. A missing file has no answers.
func readAnswers(path string, rows map[string]nameRow) (map[string]answer, int, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]answer{}, 0, nil
	}
	if err != nil {
		return nil, 0, fmt.Errorf("%w: %w", errNames, err)
	}
	got := map[string]answer{}
	rejected := 0
	for _, line := range strings.Split(string(data), "\n") {
		fields := answerFields(line)
		if len(fields) < 4 {
			continue
		}
		row, ok := rows[fields[0]]
		if !ok {
			continue
		}
		if !sameName(fields[1], row) {
			rejected++
			continue
		}
		a := answer{british: fields[2], american: fields[3]}
		if len(fields) > 4 {
			a.reason = fields[4]
		}
		got[row.ID] = a
	}
	return got, rejected, nil
}

// answerFields splits one pasted line into its fields, as a CSV row or as a Markdown table row, with
// stray quotes and backticks trimmed from each field. It returns nil for a line it cannot read.
func answerFields(line string) []string {
	line = strings.Trim(strings.TrimSpace(line), "`")
	if line == "" {
		return nil
	}
	var fields []string
	if strings.HasPrefix(line, "|") {
		fields = strings.Split(strings.Trim(line, "|"), "|")
	} else {
		r := csv.NewReader(strings.NewReader(line))
		r.LazyQuotes = true
		r.FieldsPerRecord = -1
		r.TrimLeadingSpace = true
		record, err := r.Read()
		if err != nil {
			return nil
		}
		fields = record
	}
	for i, f := range fields {
		fields[i] = strings.Trim(strings.TrimSpace(f), "`\"")
	}
	return fields
}

// sameName reports whether a name as a writer gave it matches the row's name or one of its source
// spellings, ignoring case.
func sameName(given string, row nameRow) bool {
	if strings.EqualFold(given, row.Name) {
		return true
	}
	for _, spelling := range row.Spellings {
		if strings.EqualFold(given, spelling) {
			return true
		}
	}
	return false
}

// writeBatches replaces the batches in dir that start with prefix: each holds the named prompt and
// then at most size records under the header. It returns the number of batches written.
func writeBatches(dir, prefix, prompt string, header []string, records [][]string, size int) (int, error) {
	old, err := filepath.Glob(filepath.Join(dir, prefix+"[0-9]*.txt"))
	if err != nil {
		return 0, fmt.Errorf("%w: %w", errNames, err)
	}
	for _, path := range old {
		if err := os.Remove(path); err != nil {
			return 0, fmt.Errorf("%w: %w", errNames, err)
		}
	}
	total := (len(records) + size - 1) / size
	for n := range total {
		chunk := records[n*size : min(len(records), (n+1)*size)]
		var buf bytes.Buffer
		data := promptData{Count: len(chunk), Batch: n + 1, Total: total, Symbols: voice.PhonemeSymbols()}
		if err := prompts.ExecuteTemplate(&buf, prompt, data); err != nil {
			return 0, fmt.Errorf("%w: %w", errNames, err)
		}
		w := csv.NewWriter(&buf)
		if err := w.Write(header); err != nil {
			return 0, fmt.Errorf("%w: %w", errNames, err)
		}
		if err := w.WriteAll(chunk); err != nil {
			return 0, fmt.Errorf("%w: %w", errNames, err)
		}
		path := filepath.Join(dir, fmt.Sprintf("%s%02d.txt", prefix, n+1))
		if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil { //nolint:gosec // Batch for the owner.
			return 0, fmt.Errorf("%w: %w", errNames, err)
		}
	}
	return total, nil
}

// ensureAnswerFile creates a writer's answer file with its header line when it does not exist, and
// leaves an existing one untouched.
func ensureAnswerFile(dir, writer string) error {
	f, err := os.OpenFile(answerPath(dir, writer), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if errors.Is(err, fs.ErrExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("%w: %w", errNames, err)
	}
	_, err = f.WriteString(answerHeaders[writer] + "\n\n")
	if err := errors.Join(err, f.Close()); err != nil {
		return fmt.Errorf("%w: %w", errNames, err)
	}
	return nil
}

// answerPath returns the path of a writer's answer file in dir.
func answerPath(dir, writer string) string {
	return filepath.Join(dir, answerPrefix+writer+".txt")
}

// loadIndex reads the name index in dir. A missing index is empty, and a missing directory is an
// error, since the batches never create one.
func loadIndex(dir string) (nameIndex, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return nameIndex{}, fmt.Errorf("%w: %w", errNames, err)
	}
	if !info.IsDir() {
		return nameIndex{}, fmt.Errorf("%w: %s is not a directory", errNames, dir)
	}
	data, err := os.ReadFile(filepath.Join(dir, indexFile))
	if errors.Is(err, fs.ErrNotExist) {
		return nameIndex{}, nil
	}
	if err != nil {
		return nameIndex{}, fmt.Errorf("%w: %w", errNames, err)
	}
	var index nameIndex
	if err := json.Unmarshal(data, &index); err != nil {
		return nameIndex{}, fmt.Errorf("%w: %s: %w", errNames, indexFile, err)
	}
	return index, nil
}

// saveIndex writes the name index to dir.
func saveIndex(dir string, index nameIndex) error {
	data, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		return fmt.Errorf("%w: %w", errNames, err)
	}
	path := filepath.Join(dir, indexFile)
	if err := os.WriteFile(path, append(data, '\n'), 0o644); err != nil { //nolint:gosec // Index for the owner.
		return fmt.Errorf("%w: %w", errNames, err)
	}
	return nil
}

// rowRecord returns a name's batch columns: id, name, spelling, context, battle, and year.
func rowRecord(row nameRow) []string {
	return []string{row.ID, row.Name, strings.Join(row.Spellings, " "), row.Context, row.Battle, row.Year}
}

// excerpt returns the sentence of text that holds word, cut to at most maxContext characters around
// the word.
func excerpt(text, word string) string {
	at := strings.Index(text, word)
	if at < 0 {
		return ""
	}
	start := strings.LastIndexAny(text[:at], ".!?") + 1
	end := len(text)
	if i := strings.IndexAny(text[at:], ".!?"); i >= 0 {
		end = at + i + 1
	}
	sentence := strings.TrimSpace(text[start:end])
	runes := []rune(sentence)
	if len(runes) <= maxContext {
		return sentence
	}
	pos := utf8.RuneCountInString(sentence[:strings.Index(sentence, word)])
	from := max(0, min(pos-maxContext/2, len(runes)-maxContext))
	window := string(runes[from : from+maxContext])
	if from > 0 {
		if _, after, ok := strings.Cut(window, " "); ok {
			window = after
		}
	}
	if from+maxContext < len(runes) {
		if i := strings.LastIndex(window, " "); i > 0 {
			window = window[:i]
		}
	}
	return strings.TrimSpace(window)
}

// yearText writes a battle's year for a batch row, with BC for a year before the common era and
// nothing for an unknown year.
func yearText(year int) string {
	switch {
	case year < 0:
		return strconv.Itoa(-year) + " BC"
	case year == 0:
		return ""
	default:
		return strconv.Itoa(year)
	}
}
