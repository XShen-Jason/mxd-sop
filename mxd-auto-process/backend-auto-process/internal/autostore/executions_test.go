package autostore

import (
	"path/filepath"
	"testing"
)

func TestExecutionRoundRobinAndPersistence(t *testing.T) {
	dir := t.TempDir()
	store, err := Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	first, ok, err := store.NextRoundRobin("server", []string{"a", "b"})
	if err != nil || !ok || first != "a" {
		t.Fatalf("first selection = %q, %v, %v", first, ok, err)
	}
	second, ok, err := store.NextRoundRobin("server", []string{"a", "b"})
	if err != nil || !ok || second != "b" {
		t.Fatalf("second selection = %q, %v, %v", second, ok, err)
	}
	execution := Execution{ID: "group-1", ServerID: "server", RequestHash: ExecutionHash("server", []ExecutionCommand{{ID: "0:0", Text: "drop@1@2@1"}}), Commands: []ExecutionCommand{{ID: "0:0", Text: "drop@1@2@1", Status: "success"}}, Status: "success", Attempts: 1, CreatedAt: "now", UpdatedAt: "now"}
	if err := store.SaveExecution(execution); err != nil {
		t.Fatal(err)
	}
	loaded, found, err := store.Execution("group-1")
	if err != nil || !found || loaded.Commands[0].Status != "success" {
		t.Fatalf("loaded execution = %+v, %v, %v", loaded, found, err)
	}
}
