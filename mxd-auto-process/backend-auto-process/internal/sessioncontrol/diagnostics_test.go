package sessioncontrol

import (
	"context"
	"errors"
	"testing"

	"github.com/local/mxd-auto-process/internal/servercatalog"
)

func TestFreshKeylessProbeRequiresExplicitServerFlag(t *testing.T) {
	manager, dialer := newDiagnosticsManager(t, false)
	defer manager.Close()
	if _, err := manager.ProbeChatWithoutLogin(context.Background(), "local", "111"); !errors.Is(err, ErrKeylessProbeDenied) {
		t.Fatalf("expected disabled probe error, got %v", err)
	}
	if len(dialer.clients) != 0 {
		t.Fatalf("disabled probe unexpectedly dialed %d clients", len(dialer.clients))
	}
}

func TestFreshKeylessProbeUsesOneBoundedConnection(t *testing.T) {
	manager, dialer := newDiagnosticsManager(t, true)
	defer manager.Close()
	result, err := manager.ProbeChatWithoutLogin(context.Background(), "local", "111")
	if err != nil || result.ConnectionMode != "fresh_connection_without_login" {
		t.Fatalf("unexpected probe result: %+v %v", result, err)
	}
	if len(dialer.clients) != 1 || !dialer.clients[0].closed || len(dialer.clients[0].sent) != 1 {
		t.Fatalf("probe connection lifecycle was unexpected: %+v", dialer.clients)
	}
	if operation := dialer.clients[0].sent[0].Op; operation == nil || *operation != 10 {
		t.Fatalf("probe sent unexpected message: %+v", dialer.clients[0].sent[0])
	}
}

func newDiagnosticsManager(t *testing.T, enabled bool) (*Manager, *fakeDialer) {
	t.Helper()
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
		AllowKeylessProbe: enabled,
	}})
	if err != nil {
		t.Fatal(err)
	}
	dialer := &fakeDialer{}
	manager, err := New(catalog, dialer, 2)
	if err != nil {
		t.Fatal(err)
	}
	return manager, dialer
}
