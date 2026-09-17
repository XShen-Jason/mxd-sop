package operatorapi

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

func TestExecutionWithoutOnlineAccountIsIdempotent(t *testing.T) {
	dir := t.TempDir()
	store, err := autostore.Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1", MapID: "1", Enabled: true}})
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
	body := `{"execution_id":"group-1","commands":[{"id":"0:0","text":"herwarp@1"}]}`
	first := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/executions", body)
	if first.Code != http.StatusOK || !strings.Contains(first.Body.String(), `"status":"failure"`) || !strings.Contains(first.Body.String(), `"failure_reason":"no_online_accounts"`) {
		t.Fatalf("first execution = %d %s", first.Code, first.Body.String())
	}
	second := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/executions", body)
	if second.Code != http.StatusOK || !strings.Contains(second.Body.String(), `"attempts":1`) {
		t.Fatalf("duplicate execution = %d %s", second.Code, second.Body.String())
	}
}

func TestPlayerNamePermissionErrorRemovesOnlyTheRejectedAccount(t *testing.T) {
	if !gamesession.IsPlayerNamePermissionResponse("  \u8bf7\u8f93\u5165\u6b63\u786e\u7684\u73a9\u5bb6\u59d3\u540d\u3002\n") {
		t.Fatal("expected the game permission response to trigger account switching")
	}
	if gamesession.IsPlayerNamePermissionResponse("\u76ee\u6807\u73a9\u5bb6\u4e0d\u5728\u7ebf") {
		t.Fatal("offline responses must not switch privileged accounts")
	}
	remaining := removeAccountID([]string{"account-1", "account-2", "account-3"}, "account-2")
	if strings.Join(remaining, ",") != "account-1,account-3" {
		t.Fatalf("unexpected remaining accounts: %v", remaining)
	}
}

func TestExecutionSwitchesAccountsAfterPlayerNamePermissionFailure(t *testing.T) {
	dir := t.TempDir()
	store, err := autostore.Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	requireMapEvents, postEntryInit := false, false
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1", MapID: "1",
		Enabled: true, RequireMapEvents: &requireMapEvents, PostEntryInit: &postEntryInit, RequestTimeoutSeconds: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	permissionResponses := []gameprotocol.Message{apiLoginResponse(), apiResponse(6, 0), apiResponse(7, 0)}
	for index := 0; index < 8; index++ {
		permissionResponses = append(permissionResponses, apiSystemEvent("\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u73a9\u5bb6\u59d3\u540d\u3002"))
	}
	successResponses := []gameprotocol.Message{apiLoginResponse(), apiResponse(6, 0), apiResponse(7, 0)}
	for index := 0; index < 8; index++ {
		successResponses = append(successResponses, apiSystemEvent("\u5df2\u5c06\u7269\u54c1[100000069]\u00d71\u53d1\u9001\u5230\u73a9\u5bb6[REF]\u7684\u80cc\u5305\u3002"))
	}
	clients := []*apiClient{{responses: permissionResponses}, {responses: successResponses}}
	manager, err := sessioncontrol.New(catalog, &executionDialer{clients: clients}, 2)
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
	created := make([]sessioncontrol.AccountSnapshot, 0, 2)
	for index := range clients {
		login := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/sessions", `{"account":"player","password":"game123"}`)
		var session sessioncontrol.Snapshot
		if err := json.Unmarshal(login.Body.Bytes(), &session); err != nil {
			t.Fatal(err)
		}
		serviceRequest(t, handler, http.MethodPost, "/api/v1/sessions/"+session.ID+"/select-and-enter", `{"character_id":"role-1"}`)
		account := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/accounts", `{"username":"player-`+string(rune('1'+index))+`","password":"game123","character_id":"role-1","session_id":"`+session.ID+`"}`)
		var snapshot sessioncontrol.AccountSnapshot
		if err := json.Unmarshal(account.Body.Bytes(), &snapshot); err != nil {
			t.Fatal(err)
		}
		created = append(created, snapshot)
	}
	execution := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/executions", `{"execution_id":"permission-fallback","commands":[{"id":"0:0","text":"drop@315@100000069@1"}]}`)
	if execution.Code != http.StatusOK || !strings.Contains(execution.Body.String(), `"status":"success"`) || !strings.Contains(execution.Body.String(), `"account_id":"`+created[1].ID+`"`) {
		t.Fatalf("execution did not switch to the second account: %d %s", execution.Code, execution.Body.String())
	}
}

type executionDialer struct {
	clients []*apiClient
	next    int
}

func (d *executionDialer) Dial(_ context.Context, _ string, _ uint32) (gameprotocol.Client, error) {
	client := d.clients[d.next]
	d.next++
	return client, nil
}

func TestExecutionSendsEachCommandAsAnIndependentPrivateChat(t *testing.T) {
	dir := t.TempDir()
	store, err := autostore.Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	requireMapEvents, postEntryInit := false, false
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1", MapID: "1",
		Enabled: true, RequireMapEvents: &requireMapEvents, PostEntryInit: &postEntryInit, RequestTimeoutSeconds: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	responses := []gameprotocol.Message{apiLoginResponse(), apiResponse(6, 0), apiResponse(7, 0)}
	for index := 0; index < 22; index++ {
		responses = append(responses, apiSystemEvent("\u5df2\u5c06\u7269\u54c1[100000069]\u00d71\u53d1\u9001\u5230\u73a9\u5bb6[REF]\u7684\u80cc\u5305\u3002"))
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
	login := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/sessions", `{"account":"player","password":"game123"}`)
	if login.Code != http.StatusCreated {
		t.Fatalf("login failed: %d %s", login.Code, login.Body.String())
	}
	var loggedIn sessioncontrol.Snapshot
	if err := json.Unmarshal(login.Body.Bytes(), &loggedIn); err != nil {
		t.Fatal(err)
	}
	entered := serviceRequest(t, handler, http.MethodPost, "/api/v1/sessions/"+loggedIn.ID+"/select-and-enter", `{"character_id":"role-1"}`)
	if entered.Code != http.StatusOK {
		t.Fatalf("select and enter failed: %d %s", entered.Code, entered.Body.String())
	}
	created := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/accounts", `{"username":"player","password":"game123","character_id":"role-1","session_id":"`+loggedIn.ID+`"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("account creation failed: %d %s", created.Code, created.Body.String())
	}
	commands := make([]string, 20)
	for index := range commands {
		commands[index] = `{"id":"` + string(rune('a'+index)) + `","text":"drop@265@100000069@1"}`
	}
	execution := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/executions", `{"execution_id":"twenty-items","commands":[`+strings.Join(commands, ",")+`]}`)
	if execution.Code != http.StatusOK || !strings.Contains(execution.Body.String(), `"status":"success"`) {
		t.Fatalf("execution failed: %d %s", execution.Code, execution.Body.String())
	}
	privateChats := make([]gameprotocol.Message, 0, 20)
	for _, message := range dialer.client.sent {
		channel, _ := message.StringParam(21)
		if channel == gameprotocol.PrivateChatChannel {
			privateChats = append(privateChats, message)
		}
	}
	if len(privateChats) != 20 {
		t.Fatalf("expected one private chat frame per command, got %d: %s", len(privateChats), execution.Body.String())
	}
}
