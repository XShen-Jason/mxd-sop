package operatorapi

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

func protectionHandler(t *testing.T, directory string) *Handler {
	t.Helper()
	store, err := autostore.Open(filepath.Join(directory, "auto.sqlite"), filepath.Join(directory, "key"), "InitialAutoPass!")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true}})
	if err != nil {
		t.Fatal(err)
	}
	manager, err := sessioncontrol.New(catalog, authTestDialer{}, 1)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { manager.Close() })
	result, err := NewHandler(manager, catalog, Options{Store: store, ServiceToken: testServiceToken})
	if err != nil {
		t.Fatal(err)
	}
	return result.(*Handler)
}

func TestPermanentBanSurvivesTemporaryExpirySuccessAndRestart(t *testing.T) {
	directory := t.TempDir()
	h := protectionHandler(t, directory)
	now := time.Now()
	h.loginNow = func() time.Time { return now }
	for failure := 1; failure <= 20; failure++ {
		response := performOperatorLogin(t, h, `{"username":"admin","password":"wrong"}`)
		want := http.StatusUnauthorized
		if failure%5 == 0 {
			want = http.StatusTooManyRequests
		}
		if response.Code != want {
			t.Fatalf("failure %d: %d %s", failure, response.Code, response.Body.String())
		}
		if failure%5 == 0 {
			for i := 0; i < 25; i++ {
				if response := performOperatorLogin(t, h, `{"username":"other","password":"wrong"}`); response.Code != 429 {
					t.Fatal(response.Code)
				}
			}
			now = now.Add(20 * time.Minute)
			if response := performOperatorLogin(t, h, `{"username":"admin","password":"InitialAutoPass!"}`); response.Code != 200 {
				t.Fatal(response.Body.String())
			}
		}
	}
	_ = h.store.Close()
	h = protectionHandler(t, directory)
	response := performOperatorLogin(t, h, `{"username":"admin","password":"wrong"}`)
	if response.Code != 403 || !strings.Contains(response.Body.String(), "ip_permanently_banned") || response.Header().Get("Retry-After") != "" {
		t.Fatal(response.Code, response.Body.String())
	}
	_ = h.store.Close()
	h = protectionHandler(t, directory)
	for _, route := range []string{"/", "/api/v1/healthz", "/api/v1/operator/me"} {
		req := httptest.NewRequest(http.MethodGet, route, nil)
		req.RemoteAddr = "[::ffff:192.0.2.10]:1234"
		req.Header.Set("Authorization", "Bearer "+testServiceToken)
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		if out.Code != 403 {
			t.Fatalf("%s: %d", route, out.Code)
		}
	}
	count, err := h.store.IPFailureCount("192.0.2.10")
	if err != nil || count != 21 {
		t.Fatal(count, err)
	}
}

func TestRequestQuotaIncludesMalformedBodiesAndSuccessfulLogins(t *testing.T) {
	h := protectionHandler(t, t.TempDir())
	now := time.Now()
	h.loginNow = func() time.Time { return now }
	for round := 0; round < 3; round++ {
		for i := 0; i < 10; i++ {
			body, want := `{`, 400
			if i%2 == 0 {
				body, want = `{"username":"admin","password":"InitialAutoPass!"}`, 200
			}
			if out := performOperatorLogin(t, h, body); out.Code != want {
				t.Fatal(out.Code, out.Body.String())
			}
		}
		out := performOperatorLogin(t, h, `{}`)
		if out.Code != 429 || out.Header().Get("Retry-After") != "300" {
			t.Fatal(out.Code, out.Body.String())
		}
		now = now.Add(299*time.Second + time.Millisecond)
		if out := performOperatorLogin(t, h, `{}`); out.Header().Get("Retry-After") != "1" {
			t.Fatal(out.Body.String())
		}
		now = now.Add(999 * time.Millisecond)
	}
	count, err := h.store.IPFailureCount("192.0.2.10")
	if err != nil || count != 0 {
		t.Fatal(count, err)
	}
}

func TestProxyIdentityAndIPv6Rejection(t *testing.T) {
	h := protectionHandler(t, t.TempDir())
	for _, peer := range []string{"[2001:db8::1]:1234", "[::1]:1234"} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
		req.RemoteAddr = peer
		if !strings.Contains(peer, "[::1]") {
			req.Header.Set("X-Forwarded-For", "192.0.2.3")
		}
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		if out.Code != 403 || !strings.Contains(out.Body.String(), "ipv6_disabled") {
			t.Fatal(out.Code, out.Body.String())
		}
	}
	for _, peer := range []string{"127.0.0.1:1234", "[::ffff:127.0.0.1]:1234", "[::1]:1234"} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
		req.RemoteAddr = peer
		req.Header.Set("X-Forwarded-For", "2001:db8::123, ::ffff:192.0.2.3")
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		if out.Code != 200 {
			t.Fatal(out.Code, out.Body.String())
		}
		req.Header.Set("X-Forwarded-For", "192.0.2.3, 2001:db8::123")
		out = httptest.NewRecorder()
		h.ServeHTTP(out, req)
		if out.Code != 403 {
			t.Fatal(out.Code)
		}
	}
	for i := 0; i < 6; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operator/login", strings.NewReader(fmt.Sprintf(`{"username":"other-%d","password":"wrong"}`, i)))
		req.RemoteAddr = "192.0.2.20:1"
		req.Header.Set("X-Forwarded-For", fmt.Sprintf("198.51.100.%d", i))
		req.Header.Set("CF-Connecting-IP", fmt.Sprintf("198.51.100.%d", i))
		out := httptest.NewRecorder()
		h.ServeHTTP(out, req)
		want := 401
		if i >= 4 {
			want = 429
		}
		if out.Code != want {
			t.Fatal(out.Code, out.Body.String())
		}
	}
}

func TestConcurrentFailuresStopAtTemporaryAndPermanentThresholds(t *testing.T) {
	h := protectionHandler(t, t.TempDir())
	now := time.Now()
	h.loginNow = func() time.Time { return now }
	round := func(want401, want429, want403 int) {
		var wg sync.WaitGroup
		codes := make(chan int, 30)
		for i := 0; i < 30; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				codes <- performOperatorLogin(t, h, `{"username":"admin","password":"wrong"}`).Code
			}()
		}
		wg.Wait()
		close(codes)
		counts := map[int]int{}
		for code := range codes {
			counts[code]++
		}
		if counts[401]+counts[429]+counts[403] != 30 || counts[401] != want401 ||
			(want429 >= 0 && counts[429] != want429) || (want403 >= 0 && counts[403] != want403) ||
			(want403 < 0 && counts[403] == 0) {
			t.Fatal(counts)
		}
	}
	round(4, 26, 0)
	for i := 0; i < 15; i++ {
		if _, err := h.store.RecordIPFailure("192.0.2.10", 21, maxFailureIPs); err != nil {
			t.Fatal(err)
		}
	}
	now = now.Add(20 * time.Minute)
	// Reopen clears transient request reservations; only failure 21 can be verified.
	h.loginFailures = make(map[string]*loginFailure)
	// Requests rejected by the quota before failure 21 commits may still be 429.
	// No additional credential verification is allowed once the ban commits.
	round(0, -1, -1)
	count, err := h.store.IPFailureCount("192.0.2.10")
	if err != nil || count != 21 {
		t.Fatal(count, err)
	}
}
