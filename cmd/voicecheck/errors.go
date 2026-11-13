package main

import "errors"

var (
	// errFailed reports that at least one battle or name list entry failed a rule.
	errFailed = errors.New("battles failed the voice check")
	// errNames reports a name batch or answer file that cannot be read or written.
	errNames = errors.New("name batches")
)
