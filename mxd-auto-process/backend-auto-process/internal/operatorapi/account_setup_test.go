package operatorapi

import (
	"encoding/json"
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

func TestAccountCreateAdoptsInteractiveSession(t *testing.T) {
	const md5Token = "5AA765D61D8327DE"
	directory := t.TempDir()
	store, err := autostore.Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	requireMapEvents, postEntryInit := false, false
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
		RequireMapEvents: &requireMapEvents, PostEntryInit: &postEntryInit, RequestTimeoutSeconds: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	dialer := &apiDialer{client: &apiClient{responses: []gameprotocol.Message{apiLoginResponse(), apiResponse(6, 0), apiResponse(7, 0)}}}
	manager, err := sessioncontrol.New(catalog, dialer, 2)
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

	login := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/sessions", `{"account":"player","password":"`+md5Token+`","credential_type":"md5"}`)
	if login.Code != http.StatusCreated || strings.Contains(login.Body.String(), md5Token) {
		t.Fatalf("interactive login failed or leaked the password: %d %s", login.Code, login.Body.String())
	}
	if token, _ := dialer.client.sent[0].StringParam(1); token != md5Token {
		t.Fatalf("MD5 login value changed before protocol send: got %q want %q", token, md5Token)
	}
	var loggedIn sessioncontrol.Snapshot
	if err := json.Unmarshal(login.Body.Bytes(), &loggedIn); err != nil {
		t.Fatal(err)
	}
	if len(loggedIn.Roles) != 1 || loggedIn.Roles[0].ID != "role-1" {
		t.Fatalf("login response did not expose the server role list: %+v", loggedIn)
	}

	entered := serviceRequest(t, handler, http.MethodPost, "/api/v1/sessions/"+loggedIn.ID+"/select-and-enter", `{"character_id":"role-1"}`)
	if entered.Code != http.StatusOK || !strings.Contains(entered.Body.String(), `"state":"ready"`) {
		t.Fatalf("interactive role entry failed: %d %s", entered.Code, entered.Body.String())
	}
	created := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/accounts", `{"username":"player","password":"`+md5Token+`","credential_type":"md5","character_id":"role-1","character_name":"Fixture","session_id":"`+loggedIn.ID+`"}`)
	if created.Code != http.StatusCreated || strings.Contains(created.Body.String(), md5Token) {
		t.Fatalf("account creation failed or leaked the password: %d %s", created.Code, created.Body.String())
	}
	list, err := accounts.List("local")
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].CredentialType != autostore.CredentialMD5 || list[0].Status != sessioncontrol.AccountOnline || list[0].SessionID != loggedIn.ID {
		t.Fatalf("interactive session was not bound to the account: %+v", list)
	}
	if len(dialer.client.sent) != 3 {
		t.Fatalf("account creation logged in a second time: sent %d frames", len(dialer.client.sent))
	}
}

func serviceRequest(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer service-token")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}
