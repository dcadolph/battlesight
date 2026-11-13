// Command voicecheck checks every replay's narration for anything the narrator voice would misread.
// It builds each replay the way the server does, hand-built first and generated otherwise, rewrites
// each phase as speakable text, and prints one tab-separated line per problem: battle, phase, rule,
// and word. It exits 1 when any battle fails, so a failing battle is never voiced.
//
// With -dump it also writes every phase's speakable text as JSON lines for the voicing scripts.
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

// errFailed reports that at least one battle failed a rule.
var errFailed = errors.New("battles failed the voice check")

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
	// Problems lists the rules the speakable text fails, empty when it passes.
	Problems []voice.Problem `json:"problems,omitempty"`
}

func main() {
	dbPath := flag.String("db", "data/battlesight.db", "SQLite database, opened read-only")
	phasesPath := flag.String("phases", "data/phases.json", "hand-built replay file")
	all := flag.Bool("all", false, "check every battle, not only the ones the globe lists")
	dumpPath := flag.String("dump", "", "write each phase's speakable text as JSON lines to this file")
	summary := flag.Bool("summary", false, "print only the totals")
	flag.Parse()

	err := run(*dbPath, *phasesPath, *dumpPath, *all, *summary)
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
}

// run checks every replay and reports the problems, returning errFailed when any battle fails.
func run(dbPath, phasesPath, dumpPath string, all, summary bool) (err error) {
	ctx := context.Background()
	database, err := db.OpenReadOnly(dbPath)
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, database.Close()) }()
	store := battles.NewStore(database)
	replays := battles.NewReplays()
	if _, err := replays.Load(phasesPath); err != nil {
		return err
	}
	sideNames, err := store.SideNames(ctx)
	if err != nil {
		return err
	}
	filter := battles.Filter{}
	if all {
		filter = battles.Filter{Quality: "all", IncludeNoCoord: true}
	}
	list, _, err := store.List(ctx, filter)
	if err != nil {
		return err
	}

	var dump *bufio.Writer
	if dumpPath != "" {
		f, err := os.Create(dumpPath)
		if err != nil {
			return fmt.Errorf("create dump: %w", err)
		}
		dump = bufio.NewWriter(f)
		defer func() { err = errors.Join(err, dump.Flush(), f.Close()) }()
	}

	var report strings.Builder
	counts, err := check(list, replays, battles.NewFlagNames(sideNames), &report, dump)
	if err != nil {
		return err
	}
	if !summary {
		if _, err := os.Stdout.WriteString(report.String()); err != nil {
			return fmt.Errorf("write report: %w", err)
		}
	}
	printTally(counts)
	if counts.failed > 0 {
		return errFailed
	}
	return nil
}

// check runs the rules over every phase of every listed battle's replay. It writes one line per
// problem to report and, when dump is not nil, every phase as a JSON line.
func check(list []battles.Battle, replays *battles.Replays, flags battles.FlagNames, report *strings.Builder,
	dump *bufio.Writer) (tally, error) {
	counts := tally{byRule: map[voice.Rule]int{}}
	for _, b := range list {
		rep, hand := replays.Get(b.ID)
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
		failed := false
		for i, phase := range rep.Phases {
			counts.phases++
			line := phaseText{
				Battle: b.ID, Phase: i, Generated: !hand, War: b.War, Year: b.Year,
				Text: phase.Narration, Speakable: voice.Speakable(phase.Narration),
			}
			line.Problems = voice.Check(line.Speakable)
			for _, p := range line.Problems {
				failed = true
				counts.byRule[p.Rule]++
				fmt.Fprintf(report, "%s\t%d\t%s\t%s\n", b.ID, i, p.Rule, p.Word)
			}
			if dump != nil {
				if err := writeLine(dump, line); err != nil {
					return counts, err
				}
			}
		}
		if failed {
			counts.failed++
		}
	}
	return counts, nil
}

// printTally prints the totals to standard error.
func printTally(counts tally) {
	fmt.Fprintf(os.Stderr, "battles with a replay: %d (%d hand-built, %d generated)\n",
		counts.voiced, counts.handBuilt, counts.voiced-counts.handBuilt)
	fmt.Fprintf(os.Stderr, "phases: %d\n", counts.phases)
	fmt.Fprintf(os.Stderr, "battles failing: %d\n", counts.failed)
	rules := make([]string, 0, len(counts.byRule))
	for rule := range counts.byRule {
		rules = append(rules, string(rule))
	}
	sort.Strings(rules)
	for _, rule := range rules {
		fmt.Fprintf(os.Stderr, "  %s: %d\n", rule, counts.byRule[voice.Rule(rule)])
	}
}

// writeLine writes one phase as a JSON line.
func writeLine(w *bufio.Writer, line phaseText) error {
	data, err := json.Marshal(line)
	if err != nil {
		return fmt.Errorf("encode phase %s %d: %w", line.Battle, line.Phase, err)
	}
	data = append(data, '\n')
	if _, err := w.Write(data); err != nil {
		return fmt.Errorf("write dump: %w", err)
	}
	return nil
}
