// Command voicecheck checks every replay's narration for anything the narrator voice would misread.
// It builds each replay the way the server does, hand-built first and generated otherwise, rewrites
// each phase as speakable text, and prints one tab-separated line per problem: battle, phase, rule,
// and word. It exits 1 when any battle fails, so a failing battle is never voiced.
//
// It also finds the names each phase speaks and counts the ones the name list holds. With -names a
// battle with a name missing from the list fails. With -names-out it writes batches of the missing
// names for ChatGPT and Gemini to pronounce, and with -names-in it reads their answers back into
// the list. With -dump it writes every phase's speakable text as JSON lines for the voicing scripts.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/dcadolph/battlesight/internal/battles"
	"github.com/dcadolph/battlesight/internal/db"
	"github.com/dcadolph/battlesight/internal/voice"
)

// phaseText is one line of the -dump file.
type phaseText struct {
	// Battle is the battle id.
	Battle string `json:"battle"`
	// Phase is the phase index within the replay.
	Phase int `json:"phase"`
	// Generated is true for a replay built from the battle's data rather than hand-built.
	Generated bool `json:"generated"`
	// War is the battle's war, which picks the voice.
	War string `json:"war"`
	// Year is the battle's year, negative before the common era.
	Year int `json:"year"`
	// Text is the narration as the replay shows it.
	Text string `json:"text"`
	// Speakable is the narration rewritten for the voice.
	Speakable string `json:"speakable"`
	// Names lists the names the phase speaks, as the speakable text spells them.
	Names []string `json:"names,omitempty"`
	// Problems lists the rules the speakable text fails, empty when it passes.
	Problems []voice.Problem `json:"problems,omitempty"`
	// battleName is the battle's common name, which the name batches show.
	battleName string
	// found holds the names the phase speaks with their source spellings.
	found []voice.Name
}

// options holds the command's flags.
type options struct {
	// dbPath is the SQLite database, opened read-only.
	dbPath string
	// phasesPath is the hand-built replay file.
	phasesPath string
	// listPath is the name list file.
	listPath string
	// wordsPath is the English word list.
	wordsPath string
	// dumpPath is the file for the speakable text dump, empty for none.
	dumpPath string
	// namesOut is the directory for the name batches, empty for none.
	namesOut string
	// namesIn is the directory holding the writers' answers, empty for none.
	namesIn string
	// batchSize is the most names in one batch.
	batchSize int
	// all checks every battle, not only the ones the globe lists.
	all bool
	// hand checks only the hand-built replays.
	hand bool
	// names fails a battle with a name missing from the name list.
	names bool
	// summary prints only the totals.
	summary bool
}

func main() {
	var o options
	flag.StringVar(&o.dbPath, "db", "data/battlesight.db", "SQLite database, opened read-only")
	flag.StringVar(&o.phasesPath, "phases", "data/phases.json", "hand-built replay file")
	flag.StringVar(&o.listPath, "list", "data/names.json", "name list file")
	flag.StringVar(&o.wordsPath, "words", "/usr/share/dict/web2", "English word list, one word a line")
	flag.StringVar(&o.dumpPath, "dump", "", "write each phase's speakable text as JSON lines to this file")
	flag.StringVar(&o.namesOut, "names-out", "", "write batches of the names missing from the list to this directory")
	flag.StringVar(&o.namesIn, "names-in", "", "read the writers' answers in this directory into the name list")
	flag.IntVar(&o.batchSize, "batch", 200, "most names in one batch")
	flag.BoolVar(&o.all, "all", false, "check every battle, not only the ones the globe lists")
	flag.BoolVar(&o.hand, "hand", false, "check only the hand-built replays")
	flag.BoolVar(&o.names, "names", false, "fail a battle with a name missing from the name list")
	flag.BoolVar(&o.summary, "summary", false, "print only the totals")
	flag.Parse()

	err := run(o)
	if errors.Is(err, errFailed) {
		os.Exit(1)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "voicecheck: %v\n", err)
		os.Exit(2)
	}
}

// tally counts what the check found.
type tally struct {
	// voiced counts the battles with a replay.
	voiced int
	// handBuilt counts the battles whose replay is hand-built.
	handBuilt int
	// phases counts the phases checked.
	phases int
	// failed counts the battles with at least one problem.
	failed int
	// byRule counts the problems for each rule.
	byRule map[voice.Rule]int
	// names counts the distinct names spoken.
	names int
	// listed counts the distinct names spoken that the name list holds.
	listed int
	// complete counts the battles whose every name the name list holds.
	complete int
	// listProblems counts the name list readings that fail a rule.
	listProblems int
}

// run checks every replay and reports the problems, returning errFailed when any battle or name
// list entry fails.
func run(o options) (err error) {
	ctx := context.Background()
	database, err := db.OpenReadOnly(o.dbPath)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, database.Close()) }()
	store := battles.NewStore(database)
	replays := battles.NewReplays()
	if _, err := replays.Load(o.phasesPath); err != nil {
		return err
	}
	sideNames, err := store.SideNames(ctx)
	if err != nil {
		return err
	}
	filter := battles.Filter{}
	if o.all {
		filter = battles.Filter{Quality: "all", IncludeNoCoord: true}
	}
	list, _, err := store.List(ctx, filter)
	if err != nil {
		return err
	}
	lexicon, err := voice.LoadLexicon(o.wordsPath)
	if err != nil {
		return err
	}
	names, err := voice.LoadNameList(o.listPath)
	if err != nil {
		return err
	}

	phases, counts := buildPhases(list, replays, battles.NewFlagNames(sideNames), o.hand)
	findNames(phases, lexicon)
	if o.namesIn != "" {
		if err := importAnswers(o.namesIn, names, o.batchSize); err != nil {
			return err
		}
		if err := names.Save(o.listPath); err != nil {
			return err
		}
	}
	var report strings.Builder
	check(phases, names, o.names, &counts, &report)
	if o.dumpPath != "" {
		if err := writeDump(o.dumpPath, phases); err != nil {
			return err
		}
	}
	if o.namesOut != "" {
		if err := exportNames(o.namesOut, phases, names, o.batchSize); err != nil {
			return err
		}
	}
	if !o.summary {
		if _, err := os.Stdout.WriteString(report.String()); err != nil {
			return fmt.Errorf("write report: %w", err)
		}
	}
	printTally(counts)
	if counts.failed > 0 || counts.listProblems > 0 {
		return errFailed
	}
	return nil
}

// buildPhases builds every listed battle's replay the way the server does, hand-built first and
// generated otherwise, and returns its phases with their speakable text. With handOnly it skips
// the battles without a hand-built replay.
func buildPhases(list []battles.Battle, replays *battles.Replays, flags battles.FlagNames,
	handOnly bool) ([]phaseText, tally) {
	counts := tally{byRule: map[voice.Rule]int{}}
	var phases []phaseText
	for _, b := range list {
		rep, hand := replays.Get(b.ID)
		if handOnly && !hand {
			continue
		}
		if !hand {
			var ok bool
			if rep, ok = battles.GenerateReplay(b, flags); !ok {
				continue
			}
		}
		counts.voiced++
		if hand {
			counts.handBuilt++
		}
		for i, phase := range rep.Phases {
			phases = append(phases, phaseText{
				Battle: b.ID, Phase: i, Generated: !hand, War: b.War, Year: b.Year, battleName: b.Name,
				Text: phase.Narration, Speakable: voice.Speakable(phase.Narration),
			})
		}
	}
	counts.phases = len(phases)
	return phases, counts
}

// findNames finds the names every phase speaks, judging sentence-initial words against all the
// phases' narration.
func findNames(phases []phaseText, lexicon voice.Lexicon) {
	speakables := make([]string, len(phases))
	for i := range phases {
		speakables[i] = phases[i].Speakable
	}
	finder := voice.NewFinder(lexicon, speakables)
	for i := range phases {
		phases[i].found = finder.Names(phases[i].Text, phases[i].Speakable)
		for _, name := range phases[i].found {
			phases[i].Names = append(phases[i].Names, name.Word)
		}
	}
}

// check runs the text rules over every phase and the symbol rule over the name list, and writes
// one line per problem to report. A name missing from the list is a problem only when
// enforceNames is true. Otherwise it only counts against the battle's coverage.
func check(phases []phaseText, names voice.NameList, enforceNames bool, counts *tally, report *strings.Builder) {
	failed := map[string]bool{}
	incomplete := map[string]bool{}
	seenBattles := map[string]bool{}
	spoken := map[string]bool{}
	for i := range phases {
		line := &phases[i]
		seenBattles[line.Battle] = true
		line.Problems = voice.Check(line.Speakable)
		for _, name := range line.Names {
			spoken[name] = true
			if _, ok := names[name]; ok {
				continue
			}
			incomplete[line.Battle] = true
			if enforceNames {
				line.Problems = append(line.Problems, voice.Problem{Rule: voice.RuleName, Word: name})
			}
		}
		for _, p := range line.Problems {
			failed[line.Battle] = true
			counts.byRule[p.Rule]++
			fmt.Fprintf(report, "%s\t%d\t%s\t%s\n", line.Battle, line.Phase, p.Rule, p.Word)
		}
	}
	for _, p := range names.Problems() {
		counts.listProblems++
		counts.byRule[p.Rule]++
		fmt.Fprintf(report, "name list\t-\t%s\t%s\n", p.Rule, p.Word)
	}
	counts.failed = len(failed)
	counts.names = len(spoken)
	for name := range spoken {
		if _, ok := names[name]; ok {
			counts.listed++
		}
	}
	counts.complete = len(seenBattles) - len(incomplete)
}

// printTally prints the totals to standard error.
func printTally(counts tally) {
	fmt.Fprintf(os.Stderr, "battles with a replay: %d (%d hand-built, %d generated)\n",
		counts.voiced, counts.handBuilt, counts.voiced-counts.handBuilt)
	fmt.Fprintf(os.Stderr, "phases: %d\n", counts.phases)
	fmt.Fprintf(os.Stderr, "names spoken: %d, in the name list: %d\n", counts.names, counts.listed)
	fmt.Fprintf(os.Stderr, "battles with every name in the list: %d\n", counts.complete)
	fmt.Fprintf(os.Stderr, "battles failing: %d\n", counts.failed)
	if counts.listProblems > 0 {
		fmt.Fprintf(os.Stderr, "name list readings failing: %d\n", counts.listProblems)
	}
	rules := make([]string, 0, len(counts.byRule))
	for rule := range counts.byRule {
		rules = append(rules, string(rule))
	}
	sort.Strings(rules)
	for _, rule := range rules {
		fmt.Fprintf(os.Stderr, "  %s: %d\n", rule, counts.byRule[voice.Rule(rule)])
	}
}

// writeDump writes every phase as a JSON line to path.
func writeDump(path string, phases []phaseText) (err error) {
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create dump: %w", err)
	}
	defer func() { err = errors.Join(err, f.Close()) }()
	w := bufio.NewWriter(f)
	for _, line := range phases {
		data, err := json.Marshal(line)
		if err != nil {
			return fmt.Errorf("encode phase %s %d: %w", line.Battle, line.Phase, err)
		}
		if _, err := w.Write(append(data, '\n')); err != nil {
			return fmt.Errorf("write dump: %w", err)
		}
	}
	if err := w.Flush(); err != nil {
		return fmt.Errorf("write dump: %w", err)
	}
	return nil
}
