package gamesession

import "testing"

func TestTokenFromPasswordUsesTheMiddleSixteenMD5Characters(t *testing.T) {
	if got, want := TokenFromPassword("password"), "5aa765d61d8327de"; got != want {
		t.Fatalf("unexpected password token: got %q want %q", got, want)
	}
}

func TestProtocolTokenUsesAnAlreadyDerivedTokenUnchanged(t *testing.T) {
	const token = "5AA765D61D8327DE"
	if got := (Credentials{Token: token}).protocolToken(); got != token {
		t.Fatalf("protocol token changed: got %q want %q", got, token)
	}
}
