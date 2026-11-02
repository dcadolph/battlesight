package importer

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	// titleCanonicalNamespace caches the canonical article title per stored
	// title. An empty value records a missing page.
	titleCanonicalNamespace = "title-canonical"
	// titleBatch is the action API titles cap for unauthenticated clients.
	titleBatch = 50
)

// TitleReport summarizes one -resolve-titles run.
type TitleReport struct {
	// Titles is the number of distinct stored titles checked.
	Titles int
	// Fetched is the number of titles read live this run.
	Fetched int
	// Missing lists stored titles with no article, as "id: title".
	Missing []string
	// Redirects lists rows whose stored title redirects, as "id: title -> canonical".
	Redirects []string
}

// titleQueryResponse is the part of an action=query titles response this file reads.
type titleQueryResponse struct {
	// Query holds the rename chains and the resolved pages.
	Query struct {
		// Normalized maps requested titles to their normalized spelling.
		Normalized []geocodeRename `json:"normalized"`
		// Redirects maps normalized titles to their redirect targets.
		Redirects []geocodeRename `json:"redirects"`
		// Pages holds one entry per resolved title.
		Pages []struct {
			// Title is the page title after normalization and redirects.
			Title string `json:"title"`
			// Missing is true when no such page exists.
			Missing bool `json:"missing"`
			// Invalid is true when the title cannot name a page.
			Invalid bool `json:"invalid"`
		} `json:"pages"`
	} `json:"query"`
	// Error is set when the API refuses the request.
	Error *struct {
		// Code is the API error code, e.g. maxlag.
		Code string `json:"code"`
		// Info is the human-readable message.
		Info string `json:"info"`
	} `json:"error"`
}

// titleRow is one battle's stored Wikipedia title with what decides whether it may move.
type titleRow struct {
	// ID is the battle slug.
	ID string
	// Title is the stored Wikipedia title.
	Title string
	// Source is curated or wikidata.
	Source string
	// Verified is 1 for hand-checked rows.
	Verified int
}

// ResolveWikipediaTitles resolves every stored Wikipedia title through
// normalization and redirects, caching each answer for the audit, and reports
// the rows whose title is missing or redirects. It writes nothing to db: a
// redirect often lands on a parent article that covers several distinct
// battles, so a shared target is not proof of a duplicate.
func ResolveWikipediaTitles(ctx context.Context, db *sql.DB) (TitleReport, error) {
	var rep TitleReport
	all, err := loadTitleRows(ctx, db)
	if err != nil {
		return rep, err
	}
	canon := map[string]string{}
	var pending []string
	for _, r := range all {
		if _, seen := canon[r.Title]; seen {
			continue
		}
		c, ok := wikiCacheGet(titleCanonicalNamespace, r.Title)
		canon[r.Title] = c
		if !ok {
			pending = append(pending, r.Title)
		}
	}
	rep.Titles = len(canon)
	sort.Strings(pending)
	for start := 0; start < len(pending); start += titleBatch {
		batch := pending[start:min(start+titleBatch, len(pending))]
		got, err := canonicalTitlesFor(ctx, wikipediaAPI, batch)
		if err != nil {
			return rep, fmt.Errorf("resolve titles after %d of %d: %w", rep.Fetched, len(pending), err)
		}
		for _, t := range batch {
			canon[t] = got[t]
			wikiCacheSet(titleCanonicalNamespace, t, got[t])
		}
		rep.Fetched += len(batch)
	}
	reportCanonicalTitles(all, canon, &rep)
	return rep, nil
}

// loadTitleRows reads every battle that carries a Wikipedia title.
func loadTitleRows(ctx context.Context, db *sql.DB) ([]titleRow, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, wikipedia_title, source, verified FROM battles
		WHERE wikipedia_title != '' ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("query titles: %w", err)
	}
	defer rows.Close()
	var out []titleRow
	for rows.Next() {
		var r titleRow
		if err := rows.Scan(&r.ID, &r.Title, &r.Source, &r.Verified); err != nil {
			return nil, fmt.Errorf("scan title row: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate title rows: %w", err)
	}
	return out, nil
}

// reportCanonicalTitles records the rows whose title is missing or redirects.
func reportCanonicalTitles(all []titleRow, canon map[string]string, rep *TitleReport) {
	for _, r := range all {
		switch c := canon[r.Title]; {
		case c == "":
			rep.Missing = append(rep.Missing, r.ID+": "+r.Title)
		case c != r.Title:
			rep.Redirects = append(rep.Redirects, r.ID+": "+r.Title+" -> "+c)
		}
	}
}

// canonicalTitlesFor maps each requested title to its canonical page title, or
// to "" when the page is missing. One retry follows a 429 or maxlag answer.
func canonicalTitlesFor(ctx context.Context, api string, titles []string) (map[string]string, error) {
	resp, wait, err := doTitleQuery(ctx, api, titles)
	if err != nil {
		return nil, err
	}
	if wait > 0 {
		log.Printf("resolve-titles: server busy, retrying once in %s", wait)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
		if resp, wait, err = doTitleQuery(ctx, api, titles); err != nil {
			return nil, err
		}
		if wait > 0 {
			return nil, ErrWikipediaBusy
		}
	}
	return canonicalFromResponse(titles, resp), nil
}

// canonicalFromResponse follows the normalized and redirects chains for each
// requested title and returns the page it lands on, "" for a missing page.
func canonicalFromResponse(titles []string, resp *titleQueryResponse) map[string]string {
	rename := map[string]string{}
	for _, n := range resp.Query.Normalized {
		rename[n.From] = n.To
	}
	for _, r := range resp.Query.Redirects {
		rename[r.From] = r.To
	}
	exists := map[string]bool{}
	for _, p := range resp.Query.Pages {
		if !p.Missing && !p.Invalid {
			exists[p.Title] = true
		}
	}
	out := make(map[string]string, len(titles))
	for _, t := range titles {
		final := t
		for range geocodeRenameHops {
			next, ok := rename[final]
			if !ok {
				break
			}
			final = next
		}
		if exists[final] {
			out[t] = final
		} else {
			out[t] = ""
		}
	}
	return out
}

// doTitleQuery performs one titles query. A positive wait reports that the
// server asked for a pause.
func doTitleQuery(ctx context.Context, api string, titles []string) (*titleQueryResponse, time.Duration, error) {
	params := url.Values{
		"action":        {"query"},
		"titles":        {strings.Join(titles, "|")},
		"redirects":     {"1"},
		"format":        {"json"},
		"formatversion": {"2"},
		"maxlag":        {"5"},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, api, strings.NewReader(params.Encode()))
	if err != nil {
		return nil, 0, fmt.Errorf("build titles request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", geocodeUserAgent)
	resp, err := wikiHTTPDo(req)
	if err != nil {
		return nil, 0, fmt.Errorf("titles request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, 0, fmt.Errorf("titles api returned %d", resp.StatusCode)
	}
	var out titleQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, 0, fmt.Errorf("decode titles response: %w", err)
	}
	if out.Error != nil {
		if out.Error.Code == "maxlag" {
			return nil, retryAfterDelay(resp.Header.Get("Retry-After")), nil
		}
		return nil, 0, fmt.Errorf("titles api error: %s: %s", out.Error.Code, out.Error.Info)
	}
	return &out, 0, nil
}
