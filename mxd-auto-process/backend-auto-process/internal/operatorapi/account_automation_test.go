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

func TestAccountLoginAndAutomationAreIndependent(t *testing.T) {
	dir := t.TempDir()
	store, err := autostore.Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	f := false
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1", MapID: "1", Enabled: true, RequireMapEvents: &f, PostEntryInit: &f, RequestTimeoutSeconds: 1}})
	if err != nil {
		t.Fatal(err)
	}
	responses := []gameprotocol.Message{apiLoginResponse(), apiResponse(6, 0), apiResponse(7, 0)}
	for i := 0; i < 12; i++ {
		responses = append(responses, apiSystemEvent("已将物品[100000069]×1发送到玩家[REF]的背包。"))
	}
	dialer := &apiDialer{client: &apiClient{responses: responses}}
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
	request := func(method, path, body string, status int) string {
		t.Helper()
		r := serviceRequest(t, handler, method, path, body)
		if r.Code != status {
			t.Fatalf("%s %s: %d %s", method, path, r.Code, r.Body.String())
		}
		return r.Body.String()
	}
	login := request(http.MethodPost, "/api/v1/servers/local/sessions", `{"account":"player","password":"fixture-password"}`, 201)
	var session sessioncontrol.Snapshot
	if err := json.Unmarshal([]byte(login), &session); err != nil {
		t.Fatal(err)
	}
	request(http.MethodPost, "/api/v1/sessions/"+session.ID+"/select-and-enter", `{"character_id":"role-1"}`, 200)
	created := request(http.MethodPost, "/api/v1/servers/local/accounts", `{"username":"player","password":"fixture-password","character_id":"role-1","session_id":"`+session.ID+`"}`, 201)
	var account sessioncontrol.AccountSnapshot
	if err := json.Unmarshal([]byte(created), &account); err != nil {
		t.Fatal(err)
	}
	if account.AutomationEnabled || account.Status != sessioncontrol.AccountOnline {
		t.Fatalf("new account must be online manual-only: %+v", account)
	}
	base := "/api/v1/servers/local/accounts/" + account.ID
	checkSession := func(body string, automation bool) {
		t.Helper()
		var current sessioncontrol.AccountSnapshot
		if err := json.Unmarshal([]byte(body), &current); err != nil {
			t.Fatal(err)
		}
		if current.SessionID != session.ID || current.Status != sessioncontrol.AccountOnline || current.AutomationEnabled != automation {
			t.Fatalf("toggle changed login: %+v", current)
		}
	}
	execute := func(id string) string {
		return request(http.MethodPost, "/api/v1/servers/local/executions", `{"execution_id":"`+id+`","commands":[{"id":"1","text":"drop@265@100000069@1"}]}`, 200)
	}
	if !strings.Contains(execute("manual-only"), `"failure_reason":"no_online_accounts"`) {
		t.Fatal("manual account entered automation")
	}
	request(http.MethodPost, base+"/message", `{"message":"drop@265@100000069@1","mode":"privateChat"}`, 200)
	checkSession(request(http.MethodPatch, base, `{"automation_enabled":true}`, 200), true)
	if !strings.Contains(execute("enabled"), `"status":"success"`) {
		t.Fatal("enabled account did not execute")
	}
	checkSession(request(http.MethodPatch, base, `{"automation_enabled":false}`, 200), false)
	if !strings.Contains(execute("disabled-again"), `"failure_reason":"no_online_accounts"`) {
		t.Fatal("disabled automation account was selected")
	}
	request(http.MethodPost, base+"/message", `{"message":"drop@265@100000069@1"}`, 200)
	checkSession(request(http.MethodPost, base+"/start", `{}`, 200), false)
	request(http.MethodPatch, base, `{"automation_enabled":true}`, 200)
	stopped := request(http.MethodPost, base+"/stop", `{}`, 200)
	if !strings.Contains(stopped, `"enabled":false`) || !strings.Contains(stopped, `"automation_enabled":true`) {
		t.Fatalf("logout changed automation preference: %s", stopped)
	}
	request(http.MethodPost, base+"/message", `{"message":"must not send"}`, 409)
	request(http.MethodPatch, base, `{"automation_enabled":false}`, 200)
	offline := request(http.MethodPatch, base, `{"automation_enabled":true}`, 200)
	if !strings.Contains(offline, `"enabled":false`) || !strings.Contains(offline, `"status":"disabled"`) {
		t.Fatalf("automation switch logged in: %s", offline)
	}
	request(http.MethodPatch, base, `{"automation_enabled":"true"}`, 400)
	// The HTTP route may have fetched the old online snapshot just before logout.
	staleRequest := httptest.NewRequest(http.MethodPatch, base, strings.NewReader(`{"automation_enabled":false}`))
	staleResponse := httptest.NewRecorder()
	handler.(*Handler).updateAccount(staleResponse, staleRequest, "local", account)
	if staleResponse.Code != 200 || !strings.Contains(staleResponse.Body.String(), `"enabled":false`) || !strings.Contains(staleResponse.Body.String(), `"automation_enabled":false`) {
		t.Fatalf("stale toggle resurrected login intent: %s", staleResponse.Body.String())
	}
}
