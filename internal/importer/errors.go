package importer

import "errors"

// ErrLandMask marks a land mask file that cannot be read or decoded.
var ErrLandMask = errors.New("land mask")

// ErrWikipediaBusy reports that Wikipedia answered 429 or maxlag twice in a row.
var ErrWikipediaBusy = errors.New("wikipedia api busy after one retry")
