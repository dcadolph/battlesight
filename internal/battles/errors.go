package battles

import "errors"

// ErrWarAlias reports a wars registry whose aliases collide.
var ErrWarAlias = errors.New("war alias conflict")
