package main

import (
	"log"
	"regexp"
	"strconv"

	"github.com/dcadolph/battlesight/internal/db"
)

var yearRe = regexp.MustCompile(`\b(1[0-9]{3}|20[0-2][0-9])\b`)
var bcYearRe = regexp.MustCompile(`(\d+)\s*BC`)

func main() {
	database, err := db.Open("data/battlesight.db")
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	rows, err := database.Query("SELECT id, date FROM battles WHERE year = 0 AND date != '' AND date != '0'")
	if err != nil {
		log.Fatal(err)
	}

	type fix struct {
		id   string
		year int
	}
	var fixes []fix

	for rows.Next() {
		var id, date string
		rows.Scan(&id, &date)

		if m := bcYearRe.FindStringSubmatch(date); len(m) > 1 {
			y, _ := strconv.Atoi(m[1])
			if y > 0 {
				fixes = append(fixes, fix{id, -y})
			}
			continue
		}

		if m := yearRe.FindString(date); m != "" {
			y, _ := strconv.Atoi(m)
			if y > 0 {
				fixes = append(fixes, fix{id, y})
			}
		}
	}
	rows.Close()

	stmt, _ := database.Prepare("UPDATE battles SET year = ? WHERE id = ?")
	defer stmt.Close()

	for _, f := range fixes {
		stmt.Exec(f.year, f.id)
	}

	log.Printf("fixed %d battle years", len(fixes))

	// Also derive era from year for fixed battles.
	database.Exec(`UPDATE battles SET era = CASE
		WHEN year < 500 THEN 'ancient'
		WHEN year < 1500 THEN 'medieval'
		WHEN year < 1700 THEN 'early-modern'
		WHEN year < 1820 THEN 'napoleonic'
		WHEN year < 1914 THEN 'industrial'
		WHEN year < 1919 THEN 'world-war-1'
		WHEN year < 1939 THEN 'interwar'
		WHEN year < 1946 THEN 'world-war-2'
		ELSE 'modern'
	END WHERE year != 0 AND era = ''`)

	var remaining int
	database.QueryRow("SELECT COUNT(*) FROM battles WHERE year = 0").Scan(&remaining)
	log.Printf("%d battles still have year=0", remaining)
}
