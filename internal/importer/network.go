package importer

import (
	"errors"
	"net/http"
	"sync/atomic"
)

// ErrNetworkDisabled is returned by every HTTP path in this package when the
// process-wide network switch has been flipped off. Callers should treat it
// as a soft signal: a cache miss in offline mode is not a programming bug,
// it just means the value cannot be sourced this run.
var ErrNetworkDisabled = errors.New("network disabled by --network=false")

// networkAllowed is the process-wide kill switch. Defaults to true so the
// pipeline behaves normally when the flag is not set. Stored as an atomic
// int32 because the enrichers can run concurrently in future and we want
// the read path to stay lock-free.
var networkAllowed atomic.Bool

func init() {
	networkAllowed.Store(true)
}

// SetNetworkAllowed flips the process-wide HTTP kill switch. Once disabled,
// every Wikipedia/Wikidata fetcher in this package short-circuits with
// ErrNetworkDisabled, even on cache miss. Cached responses still serve.
func SetNetworkAllowed(allow bool) {
	networkAllowed.Store(allow)
}

// NetworkAllowed reports the current state of the kill switch.
func NetworkAllowed() bool {
	return networkAllowed.Load()
}

// wikiHTTPDo is the choke point every Wikipedia/Wikidata HTTP request goes
// through. Refuses to dial the network when SetNetworkAllowed(false) has
// been called, so a user who wants a guaranteed-no-network run can flip the
// flag once at startup and trust nothing in this package will phone home.
func wikiHTTPDo(req *http.Request) (*http.Response, error) {
	if !networkAllowed.Load() {
		return nil, ErrNetworkDisabled
	}
	return http.DefaultClient.Do(req)
}
