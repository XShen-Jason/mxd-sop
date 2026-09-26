package autostore

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestAuditHistoryIsNotAutomaticallyPruned(t *testing.T) {
	dir := t.TempDir()
	store, err := Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	for i := 0; i < 5001; i++ {
		if err := store.Record(AuditEntry{ID: fmt.Sprintf("entry-%05d", i), CreatedAt: "2026-01-01T00:00:00Z", Method: "GET", Path: "/history", Status: 200}); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	err = store.db.QueryRow("SELECT COUNT(*) FROM audit_logs").Scan(&count)
	if err != nil {
		t.Fatal(err)
	}
	if count != 5001 {
		t.Fatalf("audit history length = %d, want 5001", count)
	}
}
