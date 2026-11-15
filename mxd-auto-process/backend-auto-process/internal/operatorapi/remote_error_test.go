package operatorapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

func TestRejectedLoginIncludesSafeRemoteDiagnostics(t *testing.T) {
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	rejected := apiResponse(0, 42)
	rejected.Params = []gameprotocol.Param{{ID: 36, Value: "untrusted server text with fixture-secret"}}
	manager, err := sessioncontrol.New(catalog, &apiDialer{client: &apiClient{responses: []gameprotocol.Message{rejected}}}, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	handler, err := NewHandler(manager, catalog, Options{ServiceToken: "fixture-service-token-at-least-32-bytes"})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/servers/local/sessions",
		strings.NewReader(`{"account":"fixture-account","password":"fixture-password"}`))
	request.Header.Set("Authorization", "Bearer fixture-service-token-at-least-32-bytes")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	assertRemoteDiagnostics(t, recorder, "账号登录", 0, 42)
	for _, secret := range []string{"fixture-secret", "fixture-password", "fixture-service-token-at-least-32-bytes", "fixture-account"} {
		if strings.Contains(recorder.Body.String(), secret) {
			t.Fatalf("remote diagnostics exposed %q", secret)
		}
	}
	if len(manager.List()) != 0 {
		t.Fatal("rejected login retained a session")
	}
}

func TestWrappedRemoteErrorsIdentifyEachEntryStage(t *testing.T) {
	for _, test := range []struct {
		op    int
		stage string
	}{{6, "角色选择"}, {7, "进入地图"}, {8, "地图初始化"}, {10, "发送消息"}, {99, "游戏操作"}} {
		t.Run(test.stage, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			writeDomainError(recorder, fmt.Errorf("context: %w", &gamesession.RemoteError{Operation: test.op, Code: -7}))
			assertRemoteDiagnostics(t, recorder, test.stage, test.op, -7)
		})
	}
}

func assertRemoteDiagnostics(t *testing.T, recorder *httptest.ResponseRecorder, stage string, operation, code int) {
	t.Helper()
	var body struct{ Error, Message string }
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if recorder.Code != http.StatusBadGateway || body.Error != "remote_error" {
		t.Fatalf("remote rejection lost its stable classification: %d %s", recorder.Code, recorder.Body.String())
	}
	for _, detail := range []string{stage, fmt.Sprintf("op=%d", operation), fmt.Sprintf("rc=%d", code)} {
		if !strings.Contains(body.Message, detail) {
			t.Fatalf("remote rejection hid %q: %s", detail, recorder.Body.String())
		}
	}
}
