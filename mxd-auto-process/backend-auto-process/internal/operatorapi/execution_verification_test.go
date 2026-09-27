package operatorapi

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"testing"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

func TestVerifiedOfflineRetryPreservesSuccessfulCommands(t *testing.T) {
	handler, store, client := offlineVerificationFixture(t, true)
	commands := []autostore.ExecutionCommand{
		{ID: "0:0", Text: "drop@1852@100000069@1", Status: "pending"},
		{ID: "1:0", Text: "cashid@1852@10", Status: "pending"},
	}
	execution := autostore.Execution{ID: "verified-offline", ServerID: "local",
		RequestHash: autostore.ExecutionHash("local", commands), Commands: append([]autostore.ExecutionCommand(nil), commands...),
		Status: "failure", Attempts: 1}
	execution.Commands[0].Status = "success"
	execution.Commands[1].Status = "unknown"
	if err := store.SaveExecution(execution); err != nil {
		t.Fatal(err)
	}
	request := func(retry bool, verificationID string) executeResponse {
		t.Helper()
		body, _ := json.Marshal(executeRequest{ExecutionID: execution.ID, Commands: commands, Retry: retry, OfflineVerificationID: verificationID})
		response := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/executions", string(body))
		if response.Code != http.StatusOK {
			t.Fatalf("execution = %d %s", response.Code, response.Body.String())
		}
		var result executeResponse
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	for _, retry := range []bool{false, true} {
		if result := request(retry, ""); result.Status != "unknown" || result.Attempts != 1 {
			t.Fatalf("unverified request released delivery: %+v", result)
		}
	}
	if result := request(true, "verification-1"); result.Status != "success" || result.Attempts != 2 {
		t.Fatalf("verified retry failed: %+v", result)
	}
	request(true, "verification-1")
	var messages []string
	for _, message := range client.sent {
		if channel, _ := message.StringParam(21); channel == gameprotocol.PrivateChatChannel {
			text, _ := message.StringParam(23)
			messages = append(messages, text)
		}
	}
	if len(messages) != 1 || messages[0] != "cashid@1852@10" {
		t.Fatalf("unexpected resends: %v", messages)
	}

	// A delayed duplicate of this confirmation cannot release a new unknown.
	saved, _, err := store.Execution(execution.ID)
	if err != nil {
		t.Fatal(err)
	}
	saved.Status, saved.Commands[1].Status = "failure", "unknown"
	if err := store.SaveExecution(saved); err != nil {
		t.Fatal(err)
	}
	if result := request(true, "verification-1"); result.Status != "unknown" || result.Attempts != 2 {
		t.Fatalf("old verification released a new unknown result: %+v", result)
	}
}

func TestOfflineVerificationDoesNotChangeSuccessfulCommands(t *testing.T) {
	execution := autostore.Execution{Commands: []autostore.ExecutionCommand{
		{ID: "done", Status: "success"}, {ID: "unknown", Status: "unknown"}, {ID: "next", Status: "pending"},
	}}
	if verifyOfflineCommands(&execution, "") {
		t.Fatal("missing verification accepted")
	}
	if !verifyOfflineCommands(&execution, "verified") {
		t.Fatal("verification rejected")
	}
	if execution.Commands[0].Status != "success" || execution.Commands[1].Status != "failure" || execution.Commands[2].Status != "pending" {
		t.Fatalf("unexpected verification state: %+v", execution.Commands)
	}
	execution.Commands[1].Status = "unknown"
	if verifyOfflineCommands(&execution, "verified") {
		t.Fatal("verification reused")
	}
	if !verifyOfflineCommands(&execution, "new-verification") {
		t.Fatal("fresh verification rejected")
	}
}

func TestVerifiedOfflineWithoutGMRemainsRetryable(t *testing.T) {
	handler, store, _ := offlineVerificationFixture(t, false)
	commands := []autostore.ExecutionCommand{{ID: "0:0", Text: "cashid@1852@10", Status: "pending"}}
	execution := autostore.Execution{ID: "no-gm", ServerID: "local", RequestHash: autostore.ExecutionHash("local", commands),
		Commands: append([]autostore.ExecutionCommand(nil), commands...), Status: "failure", Attempts: 1}
	execution.Commands[0].Status = "unknown"
	if err := store.SaveExecution(execution); err != nil {
		t.Fatal(err)
	}
	for _, verificationID := range []string{"verified", ""} {
		body, _ := json.Marshal(executeRequest{ExecutionID: execution.ID, Commands: commands, Retry: true, OfflineVerificationID: verificationID})
		response := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/executions", string(body))
		var result executeResponse
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || result.Status != "failure" || result.FailureReason != "no_online_accounts" {
			t.Fatalf("verification returned to unknown without dispatch: %d %s", response.Code, response.Body.String())
		}
	}
}

func offlineVerificationFixture(t *testing.T, withAccount bool) (http.Handler, *autostore.Store, *apiClient) {
	t.Helper()
	dir := t.TempDir()
	store, err := autostore.Open(filepath.Join(dir, "auto.sqlite"), filepath.Join(dir, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	requireMapEvents, postEntryInit := false, false
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1", MapID: "1",
		Enabled: true, RequireMapEvents: &requireMapEvents, PostEntryInit: &postEntryInit, RequestTimeoutSeconds: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	client := &apiClient{responses: []gameprotocol.Message{
		apiLoginResponse(), apiResponse(6, 0), apiResponse(7, 0), apiEvent(2), apiMapEvent("1"),
		apiSystemEvent("已给角色[REF(1852)]发放点券 10"),
	}}
	manager, err := sessioncontrol.New(catalog, &apiDialer{client: client}, 2)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { manager.Close() })
	accounts, err := sessioncontrol.NewAccountManager(manager, store)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { accounts.Close() })
	handler, err := NewHandler(manager, catalog, Options{Store: store, Accounts: accounts, ServiceToken: "service-token"})
	if err != nil {
		t.Fatal(err)
	}
	if !withAccount {
		return handler, store, client
	}
	login := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/sessions", `{"account":"player","password":"game123"}`)
	var session sessioncontrol.Snapshot
	if err := json.Unmarshal(login.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	entered := serviceRequest(t, handler, http.MethodPost, "/api/v1/sessions/"+session.ID+"/select-and-enter", `{"character_id":"role-1"}`)
	if entered.Code != http.StatusOK {
		t.Fatalf("enter failed: %s", entered.Body.String())
	}
	created := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/accounts", `{"username":"player","password":"game123","character_id":"role-1","automation_enabled":true,"session_id":"`+session.ID+`"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("account failed: %s", created.Body.String())
	}
	return handler, store, client
}
