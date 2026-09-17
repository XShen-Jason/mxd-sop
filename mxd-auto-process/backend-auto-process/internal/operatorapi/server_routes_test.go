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

func TestServerCreateIsNotShadowedByReadOnlyCatalogRoute(t *testing.T) {
	directory := t.TempDir()
	store, err := autostore.Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := sessioncontrol.New(catalog, routeTestDialer{}, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	accounts, err := sessioncontrol.NewAccountManager(manager, store)
	if err != nil {
		t.Fatal(err)
	}
	defer accounts.Close()
	handler, err := NewHandler(manager, catalog, Options{Store: store, Accounts: accounts, ServiceToken: "service-token"})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/servers", strings.NewReader(`{"id":"new-server","name":"New server","address":"127.0.0.1:12661","map_id":"211000000"}`))
	request.Header.Set("Authorization", "Bearer service-token")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusCreated {
		t.Fatalf("server create was shadowed by the read-only route: got %d %s", recorder.Code, recorder.Body.String())
	}
	created, ok := catalog.Get("new-server")
	if !ok {
		t.Fatal("created server was not added to the catalog")
	}
	if created.Version != servercatalog.DefaultVersion {
		t.Fatalf("created server did not use the default version: %q", created.Version)
	}
	duplicate := httptest.NewRequest(http.MethodPost, "/api/v1/servers", strings.NewReader(`{"id":"new-server","name":"New server","address":"127.0.0.1:12661","version":"1.0.2","map_id":"211000000"}`))
	duplicate.Header.Set("Authorization", "Bearer service-token")
	duplicateRecorder := httptest.NewRecorder()
	handler.ServeHTTP(duplicateRecorder, duplicate)
	if duplicateRecorder.Code != http.StatusConflict {
		t.Fatalf("duplicate server create was accepted: got %d %s", duplicateRecorder.Code, duplicateRecorder.Body.String())
	}
}

type routeTestDialer struct{}

func (routeTestDialer) Dial(context.Context, string, uint32) (gameprotocol.Client, error) {
	return nil, context.Canceled
}
