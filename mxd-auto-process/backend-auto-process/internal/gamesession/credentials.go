package gamesession

import (
	"crypto/md5"
	"encoding/hex"
)

// TokenFromPassword matches the protocol's legacy password token derivation.
// MD5 is required here for wire compatibility; it is not a password store.
func TokenFromPassword(password string) string {
	digest := md5.Sum([]byte(password))
	hexDigest := hex.EncodeToString(digest[:])
	return hexDigest[len(hexDigest)/2-8 : len(hexDigest)/2+8]
}

func (credentials Credentials) protocolToken() string {
	if credentials.Password != "" {
		return TokenFromPassword(credentials.Password)
	}
	return credentials.Token
}
