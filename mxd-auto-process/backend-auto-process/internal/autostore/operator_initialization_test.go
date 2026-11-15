package autostore

import (
	"path/filepath"
	"testing"
)

func TestNewOperatorRequiresExplicitNonDefaultPassword(t *testing.T) {
	for _, password := range []string{"", "ChangeMe-26909!"} {
		dir := t.TempDir()
		store, err := Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "credentials.key"), password)
		if err == nil {
			store.Close()
			t.Fatal("new operator accepted missing or publicly known default password")
		}
	}
}

func TestExistingOperatorReopensWithoutBootstrapPassword(t *testing.T) {
	dir := t.TempDir()
	db, key := filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "credentials.key")
	store, err := Open(db, key, "FixtureInitialPass!")
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	store, err = Open(db, key, "")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	valid, _, err := store.VerifyOperator("admin", "FixtureInitialPass!")
	if err != nil || !valid {
		t.Fatal("reopen changed the existing operator credential")
	}
}
