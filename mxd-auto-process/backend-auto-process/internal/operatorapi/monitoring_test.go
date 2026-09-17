package operatorapi

import (
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

func TestMonitoringDataRequiresAuthentication(t *testing.T) {
	handler, closeResources := monitoringHandler(t, &apiClient{})
	defer closeResources()
	page := perform(t, handler, http.MethodGet, "/", "")
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), `id="root"`) {
		t.Fatalf("root did not serve the React application: %d", page.Code)
	}
	compatibilityPage := perform(t, handler, http.MethodGet, "/operator", "")
	if compatibilityPage.Code != http.StatusOK || compatibilityPage.Body.String() != page.Body.String() {
		t.Fatalf("operator compatibility route did not serve the React application")
	}

	for _, path := range []string{
		"/api/v1/overview?include_logs=false",
		"/api/v1/logs?server_id=local",
		"/api/v1/events",
		"/api/v1/servers",
	} {
		response := perform(t, handler, http.MethodGet, path, "")
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous monitoring request %s returned %d", path, response.Code)
		}
	}
	if response := perform(t, handler, http.MethodGet, "/api/v1/healthz", ""); response.Code != http.StatusOK {
		t.Fatalf("health check should remain available: %d", response.Code)
	}
}

func TestServerLogsContainRedactedHTTPAndGameExchanges(t *testing.T) {
	client := &apiClient{responses: []gameprotocol.Message{apiLoginResponse()}}
	handler, closeResources := monitoringHandler(t, client)
	defer closeResources()

	login := serviceRequest(t, handler, http.MethodPost, "/api/v1/servers/local/sessions", `{"account":"runtime-account","password":"runtime-password"}`)
	if login.Code != http.StatusCreated {
		t.Fatalf("game login failed: %d %s", login.Code, login.Body.String())
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/logs?server_id=local&limit=20", nil)
	request.Header.Set("Authorization", "Bearer service-token")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	body := response.Body.String()
	for _, expected := range []string{"登录游戏服务器", "登录游戏账号", `"request"`, `"responses"`, "[redacted]"} {
		if !strings.Contains(body, expected) {
			t.Fatalf("server log omitted %q: %s", expected, body)
		}
	}
	for _, secret := range []string{"runtime-password", "fixture-login-key", "fixture-opaque"} {
		if strings.Contains(body, secret) {
			t.Fatalf("server log leaked %q: %s", secret, body)
		}
	}
}

func monitoringHandler(t *testing.T, client *apiClient) (http.Handler, func()) {
	t.Helper()
	directory := t.TempDir()
	store, err := autostore.Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "credentials.key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660",
		Version: "1.0.2", MapID: "211000000", Enabled: true,
		RequestTimeoutSeconds: 1,
	}})
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	manager, err := sessioncontrol.New(catalog, &apiDialer{client: client}, 2)
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	handler, err := NewHandler(manager, catalog, Options{Store: store, ServiceToken: "service-token"})
	if err != nil {
		manager.Close()
		store.Close()
		t.Fatal(err)
	}
	return handler, func() {
		manager.Close()
		store.Close()
	}
}
