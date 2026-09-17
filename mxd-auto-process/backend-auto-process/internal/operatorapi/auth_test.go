package operatorapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

func TestOperatorLoginIsRateLimitedAfterRepeatedFailures(t *testing.T) {
	directory := t.TempDir()
	store, err := autostore.Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true}})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := sessioncontrol.New(catalog, authTestDialer{}, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	handler, err := NewHandler(manager, catalog, Options{Store: store, ServiceToken: "service-token"})
	if err != nil {
		t.Fatal(err)
	}
	for attempt := 0; attempt < maxLoginFailures; attempt++ {
		response := performOperatorLogin(t, handler, `{"username":"admin","password":"wrong-password"}`)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: got %d, want unauthorized", attempt+1, response.Code)
		}
	}
	response := performOperatorLogin(t, handler, `{"username":"admin","password":"InitialAutoPass!"}`)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") == "" {
		t.Fatalf("rate limit was not enforced: %d %s", response.Code, response.Body.String())
	}
}

func performOperatorLogin(t *testing.T, handler http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/operator/login", strings.NewReader(body))
	request.RemoteAddr = "192.0.2.10:1234"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

type authTestDialer struct{}

func (authTestDialer) Dial(context.Context, string, uint32) (gameprotocol.Client, error) {
	return nil, context.Canceled
}
