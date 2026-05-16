package main

import (
	"fmt"
	"regexp"

	"github.com/dcadolph/battletrace/internal/importer"
)

func main() {
	in := "October 1914 – 11 July 1915"
	dr := importer.ParseDateRange(in, 0)
	fmt.Printf("ParseDateRange(%q) = %+v\n\n", in, dr)

	patterns := []struct {
		name string
		re   string
	}{
		{name: "fullRangeRe1", re: `(\d{1,2})\s+([A-Za-z]+)\s*(\d{3,4})?\s*[–\-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`},
		{name: "fullRangeRe2", re: `([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{3,4})\s*[–\-]\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{3,4})`},
		{name: "commaCrossMonthRe", re: `(\d{1,2})\s+([A-Za-z]+),\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`},
		{name: "dayRangeRe1", re: `([A-Za-z]+)\s+(\d{1,2})\s*[–\-]\s*(\d{1,2}),?\s+(\d{3,4})`},
		{name: "dayRangeRe2", re: `(\d{1,2})\s*[–\-]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`},
		{name: "mdyRe", re: `([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{3,4})`},
		{name: "dmyRe", re: `(\d{1,2})\s+([A-Za-z]+)\s+(\d{3,4})`},
	}
	for _, p := range patterns {
		re := regexp.MustCompile("(?i)" + p.re)
		m := re.FindStringSubmatch(in)
		if m != nil {
			fmt.Printf("MATCH %s: %v\n", p.name, m)
		} else {
			fmt.Printf("no match  %s\n", p.name)
		}
	}
}
