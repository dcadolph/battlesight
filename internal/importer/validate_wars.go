package importer

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/dcadolph/battlesight/internal/battles"
)

// snapshotWarRe matches one war key line in the territory snapshot source.
var snapshotWarRe = regexp.MustCompile(`(?m)^\s*war: (?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"),`)

// SnapshotWarKeys returns the war keys of the territory snapshot blocks in
// the frontend source, in file order, with quote escapes removed.
func SnapshotWarKeys(src string) []string {
	var out []string
	for _, m := range snapshotWarRe.FindAllStringSubmatch(src, -1) {
		k := m[1] + m[2]
		k = strings.NewReplacer(`\'`, `'`, `\"`, `"`).Replace(k)
		out = append(out, k)
	}
	return out
}

// ValidateWars checks that every war has one canonical key across wars.json,
// the territory snapshots and the curated battles: aliases do not collide,
// parents exist, each snapshot key appears once and is a canonical war key,
// and no curated battle is filed under an alias or another spelling of a key.
func ValidateWars(wars map[string]battles.WarNarrative, snapshotKeys []string,
	curated []battles.Battle) ValidationReport {
	var rep ValidationReport
	aliases, err := battles.WarAliases(wars)
	if err != nil {
		rep.Errors = append(rep.Errors, ValidationError{Field: "aliases", Message: err.Error()})
	}
	for _, name := range sortedKeys(wars) {
		if p := wars[name].Parent; p != "" {
			if _, ok := wars[p]; !ok {
				rep.Errors = append(rep.Errors, ValidationError{ID: name, Field: "parent",
					Message: fmt.Sprintf("parent %q is not a war key", p)})
			}
		}
	}
	seen := map[string]bool{}
	for _, k := range snapshotKeys {
		if seen[k] {
			rep.Errors = append(rep.Errors, ValidationError{ID: k, Field: "snapshot",
				Message: "war has two snapshot blocks; only the first is ever read"})
		}
		seen[k] = true
		if c, ok := aliases[k]; ok {
			rep.Errors = append(rep.Errors, ValidationError{ID: k, Field: "snapshot",
				Message: fmt.Sprintf("snapshot key is an alias, the frontend matches only the canonical %q", c)})
			continue
		}
		if _, ok := wars[k]; !ok {
			rep.Errors = append(rep.Errors, ValidationError{ID: k, Field: "snapshot",
				Message: "snapshot key is not a war key in wars.json"})
		}
	}
	byVariant := map[string]string{}
	for name := range wars {
		byVariant[canonWarKey(name)] = name
	}
	for _, b := range curated {
		if c, ok := aliases[b.War]; ok {
			rep.Errors = append(rep.Errors, ValidationError{ID: b.ID, Field: "war",
				Message: fmt.Sprintf("%q is an alias, use the canonical %q", b.War, c)})
			continue
		}
		if _, ok := wars[b.War]; ok || b.War == "" {
			continue
		}
		if c, ok := byVariant[canonWarKey(b.War)]; ok {
			rep.Errors = append(rep.Errors, ValidationError{ID: b.ID, Field: "war",
				Message: fmt.Sprintf("%q is a spelling of the war key %q, use the key", b.War, c)})
		}
	}
	return rep
}
