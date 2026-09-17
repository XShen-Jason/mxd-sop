package servercatalog

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gamesession"
)

func TestCatalogAppliesDefaultsAndListsEnabledServers(t *testing.T) {
	catalog, err := New([]ServerConfig{
		validServer("z-server"),
		validServer("a-server"),
		{Name: "Disabled", ID: "disabled", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: false},
	})
	if err != nil {
		t.Fatal(err)
	}
	entries := catalog.List()
	if len(entries) != 3 || entries[0].ID != "a-server" || entries[1].ID != "disabled" || entries[2].ID != "z-server" {
		t.Fatalf("unexpected catalog order: %+v", entries)
	}
	entry, ok := catalog.Get("a-server")
	if !ok || entry.ConnectTimeoutSeconds != 8 || entry.RequestTimeoutSeconds != 10 || entry.MaxBodyBytes == 0 {
		t.Fatalf("defaults were not applied: %+v", entry)
	}
	if len(catalog.PublicList()) != 3 {
		t.Fatalf("unexpected public catalog")
	}
	if got := entry.SessionConfig().RetentionMode; got != gamesession.RetainSessionData {
		t.Fatalf("unexpected default retention mode: %q", got)
	}
}

func TestCatalogAlwaysUsesFixedHeartbeat(t *testing.T) {
	server := validServer("fixed-heartbeat")
	server.Heartbeat.Enabled = false
	server.Heartbeat.IntervalSeconds = 1
	server.Heartbeat.Operation = 7
	catalog, err := New([]ServerConfig{server})
	if err != nil {
		t.Fatal(err)
	}
	entry, _ := catalog.Get("fixed-heartbeat")
	config := entry.SessionConfig()
	if config.HeartbeatInterval != 10*time.Second || config.HeartbeatOperation != 19 {
		t.Fatalf("heartbeat was not fixed: interval=%s operation=%d", config.HeartbeatInterval, config.HeartbeatOperation)
	}
}

func TestCatalogRejectsInvalidAndDuplicateEntries(t *testing.T) {
	invalid := validServer("bad-server")
	invalid.Address = "not-an-address"
	if _, err := New([]ServerConfig{invalid}); err == nil {
		t.Fatal("expected invalid address error")
	}
	first := validServer("same")
	second := validServer("same")
	if _, err := New([]ServerConfig{first, second}); err == nil {
		t.Fatal("expected duplicate id error")
	}
	oversized := validServer("large")
	oversized.MaxBodyBytes = 17 * 1024 * 1024
	if _, err := New([]ServerConfig{oversized}); err == nil {
		t.Fatal("expected oversized body limit error")
	}
	tooLong := validServer("too-long")
	tooLong.RequestTimeoutSeconds = 301
	if _, err := New([]ServerConfig{tooLong}); err == nil {
		t.Fatal("expected timeout limit error")
	}
	invalidRetention := validServer("retention")
	invalidRetention.RetentionMode = "unknown"
	if _, err := New([]ServerConfig{invalidRetention}); err == nil {
		t.Fatal("expected retention mode error")
	}
}

func TestLoadReadsEnvelopeFromDisk(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "servers.json")
	content := `{"servers":[{"id":"local","name":"Local","address":"127.0.0.1:12660","version":"1.0.2","map_id":"211000000","enabled":true}]}`
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	catalog, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := catalog.Get("local"); !ok {
		t.Fatal("loaded server is missing")
	}
}

func TestCatalogDoesNotCommitWhenPersistenceFails(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "servers.json")
	content := `{"servers":[{"id":"local","name":"Local","address":"127.0.0.1:12660","version":"1.0.2","map_id":"211000000","enabled":true}]}`
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	persistence := &failingPersistence{}
	catalog, err := LoadWithPersistence(path, persistence)
	if err != nil {
		t.Fatal(err)
	}
	persistence.err = errors.New("storage unavailable")
	if err := catalog.Upsert(validServer("new-server")); err == nil {
		t.Fatal("expected upsert persistence error")
	}
	if _, ok := catalog.Get("new-server"); ok {
		t.Fatal("failed upsert was committed to memory")
	}
	if err := catalog.Remove("local"); err == nil {
		t.Fatal("expected remove persistence error")
	}
	if _, ok := catalog.Get("local"); !ok {
		t.Fatal("failed remove was committed to memory")
	}
}

func validServer(id string) ServerConfig {
	return ServerConfig{ID: id, Name: id, Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true}
}

type failingPersistence struct {
	err error
}

func (p *failingPersistence) LoadServerCatalog() ([]ServerConfig, bool, error) {
	return nil, false, nil
}
func (p *failingPersistence) SaveServerCatalog([]ServerConfig) error { return p.err }
