package voice

import "errors"

var (
	// ErrLexicon reports a word list that cannot be read.
	ErrLexicon = errors.New("word list")
	// ErrNameList reports a name list file that cannot be read or written.
	ErrNameList = errors.New("name list")
)
