package quality

import (
	"fmt"
	"io"
	"sort"
	"strings"
)

// WriteMarkdown serialises a Report as a hand-readable Markdown document
// suitable for review. Sorted top-down by importance: headline stats,
// distribution, then the per-axis breakdowns, then the worst-quality
// verified rows and the top stars as concrete anchors.
func WriteMarkdown(w io.Writer, rep *Report) error {
	fmt.Fprintf(w, "# BattleTrace data quality report\n\n")
	fmt.Fprintf(w, "Total battles: %d.\n\n", rep.Total)
	fmt.Fprintf(w, "Average completeness score: %.1f / 100.\n\n", rep.Average)

	fmt.Fprintf(w, "## Distribution by quality tier\n\n")
	fmt.Fprintln(w, "| Tier        | Count  | Share  |")
	fmt.Fprintln(w, "|-------------|--------|--------|")
	for _, tier := range []string{"excellent", "good", "thin", "stub"} {
		n := rep.Distribution[tier]
		share := 0.0
		if rep.Total > 0 {
			share = float64(n) / float64(rep.Total) * 100
		}
		fmt.Fprintf(w, "| %-11s | %6d | %5.1f%% |\n", tier, n, share)
	}
	fmt.Fprintln(w)

	fmt.Fprintf(w, "## By era\n\n")
	fmt.Fprintln(w, "| Era            | Count  | Avg score | %% excellent | %% stub |")
	fmt.Fprintln(w, "|----------------|--------|-----------|-------------|--------|")
	eras := append([]EraStats(nil), rep.ByEra...)
	sort.Slice(eras, func(i, j int) bool { return eras[i].Count > eras[j].Count })
	for _, e := range eras {
		fmt.Fprintf(w, "| %-14s | %6d | %9.1f | %10.1f%% | %5.1f%% |\n",
			truncate(e.Era, 14), e.Count, e.Avg, e.PctOver85, e.PctUnder30)
	}
	fmt.Fprintln(w)

	fmt.Fprintf(w, "## By region\n\n")
	fmt.Fprintln(w, "| Region                                       | Count  | Avg score |")
	fmt.Fprintln(w, "|----------------------------------------------|--------|-----------|")
	regs := append([]RegionStats(nil), rep.ByRegion...)
	sort.Slice(regs, func(i, j int) bool { return regs[i].Count > regs[j].Count })
	for _, r := range regs {
		fmt.Fprintf(w, "| %-44s | %6d | %9.1f |\n", truncate(r.Region, 44), r.Count, r.Avg)
	}
	fmt.Fprintln(w)

	fmt.Fprintf(w, "## Top 30 wars by battle count\n\n")
	fmt.Fprintln(w, "| War                                                | Battles | Avg score | Excellent |")
	fmt.Fprintln(w, "|----------------------------------------------------|---------|-----------|-----------|")
	wars := append([]WarStats(nil), rep.ByWar...)
	sort.Slice(wars, func(i, j int) bool { return wars[i].Count > wars[j].Count })
	if len(wars) > 30 {
		wars = wars[:30]
	}
	for _, ws := range wars {
		fmt.Fprintf(w, "| %-50s | %7d | %9.1f | %9d |\n",
			truncate(ws.War, 50), ws.Count, ws.Avg, ws.NamedStars)
	}
	fmt.Fprintln(w)

	if len(rep.WorstByID) > 0 {
		fmt.Fprintf(w, "## Verified battles with the worst quality scores (repair queue)\n\n")
		fmt.Fprintln(w, "| ID                                       | Name                                     | Era            | Year   | Score |")
		fmt.Fprintln(w, "|------------------------------------------|------------------------------------------|----------------|--------|-------|")
		for _, s := range rep.WorstByID {
			fmt.Fprintf(w, "| %-40s | %-40s | %-14s | %6d | %5d |\n",
				truncate(s.ID, 40), truncate(s.Name, 40), truncate(s.Era, 14), s.Year, s.Total)
		}
		fmt.Fprintln(w)
	}

	if len(rep.StarsByID) > 0 {
		fmt.Fprintf(w, "## Top 20 quality-score anchors\n\n")
		fmt.Fprintln(w, "| ID                                       | Name                                     | Era            | Year   | Score |")
		fmt.Fprintln(w, "|------------------------------------------|------------------------------------------|----------------|--------|-------|")
		for _, s := range rep.StarsByID {
			fmt.Fprintf(w, "| %-40s | %-40s | %-14s | %6d | %5d |\n",
				truncate(s.ID, 40), truncate(s.Name, 40), truncate(s.Era, 14), s.Year, s.Total)
		}
		fmt.Fprintln(w)
	}

	return nil
}

// truncate returns s shortened to max runes, appending an ellipsis when a
// cut actually happened so the report makes the truncation visible.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	if max <= 1 {
		return strings.Repeat("…", max)
	}
	return s[:max-1] + "…"
}
