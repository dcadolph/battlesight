package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const wikipediaAPI = "https://en.wikipedia.org/w/api.php"

type wikiQueryResponse struct {
	Query struct {
		Pages map[string]wikiPage `json:"pages"`
	} `json:"query"`
}

type wikiPage struct {
	Title   string `json:"title"`
	Extract string `json:"extract"`
}

// EnrichFromWikipedia fetches summaries from Wikipedia for battles that have
// a wikipedia_title but no summary. Processes in batches of 20 with rate limiting.
func EnrichFromWikipedia(ctx context.Context, db *sql.DB) (int, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT id, wikipedia_title FROM battles WHERE wikipedia_title != '' AND summary = ''`)
	if err != nil {
		return 0, fmt.Errorf("query battles needing enrichment: %w", err)
	}

	type battleRef struct {
		id    string
		title string
	}

	var pending []battleRef
	for rows.Next() {
		var br battleRef
		if err := rows.Scan(&br.id, &br.title); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan battle: %w", err)
		}
		pending = append(pending, br)
	}
	rows.Close()

	if len(pending) == 0 {
		return 0, nil
	}

	log.Printf("enriching %d battles from Wikipedia", len(pending))

	updateStmt, err := db.PrepareContext(ctx,
		`UPDATE battles SET summary = ? WHERE id = ?`)
	if err != nil {
		return 0, fmt.Errorf("prepare update: %w", err)
	}
	defer updateStmt.Close()

	var enriched int
	batchSize := 20

	for i := 0; i < len(pending); i += batchSize {
		end := i + batchSize
		if end > len(pending) {
			end = len(pending)
		}
		batch := pending[i:end]

		titles := make([]string, len(batch))
		titleToID := make(map[string]string, len(batch))
		for j, br := range batch {
			wikiTitle := strings.ReplaceAll(br.title, " ", "_")
			titles[j] = wikiTitle
			titleToID[br.title] = br.id
		}

		extracts, err := fetchExtracts(ctx, titles)
		if err != nil {
			log.Printf("batch %d-%d failed: %v", i, end, err)
			time.Sleep(2 * time.Second)
			continue
		}

		for title, extract := range extracts {
			normalTitle := strings.ReplaceAll(title, "_", " ")
			id, ok := titleToID[normalTitle]
			if !ok {
				for _, br := range batch {
					if strings.EqualFold(br.title, normalTitle) {
						id = br.id
						ok = true
						break
					}
				}
			}
			if !ok || extract == "" {
				continue
			}

			if _, err := updateStmt.ExecContext(ctx, extract, id); err != nil {
				continue
			}
			enriched++
		}

		if (i/batchSize)%10 == 0 {
			log.Printf("enriched %d/%d battles", enriched, len(pending))
		}

		time.Sleep(200 * time.Millisecond)
	}

	return enriched, nil
}

// fetchExtracts fetches plain-text introductions for up to 20 Wikipedia articles.
func fetchExtracts(ctx context.Context, titles []string) (map[string]string, error) {
	params := url.Values{
		"action":        {"query"},
		"prop":          {"extracts"},
		"exintro":       {"true"},
		"explaintext":   {"true"},
		"exsectionformat": {"plain"},
		"titles":        {strings.Join(titles, "|")},
		"format":        {"json"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, wikipediaAPI+"?"+params.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "BattleTrace/1.0 (https://github.com/dcadolph/battletrace)")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("wikipedia request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("wikipedia returned %d", resp.StatusCode)
	}

	var result wikiQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	extracts := make(map[string]string, len(result.Query.Pages))
	for _, page := range result.Query.Pages {
		if page.Extract != "" {
			extracts[page.Title] = page.Extract
		}
	}

	return extracts, nil
}
