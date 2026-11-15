package operatorapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

const testServiceToken = "fixture-auto-service-token-at-least-32-bytes"

func TestUnsafeServiceTokenCannotEnableAPI(t *testing.T) {
	catalog, err := servercatalog.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	manager, err := sessioncontrol.New(catalog, authTestDialer{}, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	for _, token := range []string{"local-auto-service-token", "short", strings.Repeat("x", 32) + "\n"} {
		if _, err := NewHandler(manager, catalog, Options{ServiceToken: token}); err == nil {
			t.Fatal("unsafe explicit token accepted")
		}
	}
	for _, token := range []string{"", testServiceToken} {
		handler, err := NewHandler(manager, catalog, Options{ServiceToken: token})
		if err != nil {
			t.Fatal(err)
		}
		for _, bearer := range []string{"", "local-auto-service-token"} {
			request := httptest.NewRequest(http.MethodGet, "/api/v1/overview", nil)
			request.Header.Set("X-Ops-Actor-ID", "auto-process")
			request.Header.Set("X-User-Role", "super_admin")
			if bearer != "" {
				request.Header.Set("Authorization", "Bearer "+bearer)
			}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusUnauthorized {
				t.Fatalf("identity header granted access: %d", recorder.Code)
			}
		}
	}
}
