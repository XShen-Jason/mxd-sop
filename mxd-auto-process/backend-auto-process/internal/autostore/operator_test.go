package autostore

import (
	"errors"
	"path/filepath"
	"testing"
)

func TestOperatorPasswordRequiresAtLeastSixCharacters(t *testing.T) {
	directory := t.TempDir()
	_, err := Open(filepath.Join(directory, "short.sqlite"), filepath.Join(directory, "short.key"), "12345")
	if !errors.Is(err, ErrInvalidPassword) {
		t.Fatalf("short initial password error = %v, want ErrInvalidPassword", err)
	}

	store, err := Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "123456")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.ChangeOperatorPassword(OperatorUsername, "123456", "abcdef"); err != nil {
		t.Fatalf("six-character initial password should be changeable: %v", err)
	}
	if err := store.ChangeOperatorPassword(OperatorUsername, "abcdef", "12345"); !errors.Is(err, ErrInvalidPassword) {
		t.Fatalf("short replacement password error = %v, want ErrInvalidPassword", err)
	}
}
