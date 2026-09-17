package gamesession

import "testing"

func TestTokenFromPasswordUsesTheMiddleSixteenMD5Characters(t *testing.T) {
	if got, want := TokenFromPassword("password"), "5aa765d61d8327de"; got != want {
		t.Fatalf("unexpected password token: got %q want %q", got, want)
	}
}
