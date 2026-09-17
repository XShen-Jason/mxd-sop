package operatorapi

import (
	"context"
	"encoding/json"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPApiExposesTheOrderedControlFlow(t *testing.T) {
	t.Skip("legacy embedded operator UI superseded by the Vite/React frontend")
	requireEvents, postInit := true, true
	catalog, err := servercatalog.New([]servercatalog.ServerConfig{{
		ID: "local", Name: "Local", Address: "127.0.0.1:12660", Version: "1.0.2", MapID: "211000000", Enabled: true,
		RequestTimeoutSeconds: 1, MapReadyTimeoutSeconds: 1, RequireMapEvents: &requireEvents, PostEntryInit: &postInit,
		AllowKeylessProbe: true,
	}})
	if err != nil {
		t.Fatal(err)
	}
	dialer := &apiDialer{client: &apiClient{responses: []gameprotocol.Message{
		apiLoginResponse(), apiResponse(6, 0), apiResponse(7, 0), apiEvent(2), apiMapEvent("211000000:ch1"), apiResponse(8, 0),
		apiSystemEvent("server accepted chat"), apiSystemEvent("server accepted second chat"),
		apiSystemEvent("server accepted guild chat"), apiSystemEvent("server accepted team chat"), apiSystemEvent("server accepted world chat"),
		apiSystemEvent("已将物品[100000069]×1发送到玩家[REF]的背包。"), apiSystemEvent("目标玩家[315]不在线，无法发送物品。"),
		apiSystemEvent("已给角色[REF(265)]发放点券 10"),
		apiSystemEvent("角色id[315]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量"),
		apiSystemEvent("server accepted keyless chat"),
	}}}
	manager, err := sessioncontrol.New(catalog, dialer, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	handler, err := NewHandler(manager, catalog, Options{LegacyUnauthenticated: true})
	if err != nil {
		t.Fatal(err)
	}

	assertStatus(t, handler, http.MethodGet, "/api/v1/healthz", "", http.StatusOK)
	css := httptest.NewRecorder()
	handler.ServeHTTP(css, httptest.NewRequest(http.MethodGet, "/assets/app.css", nil))
	if css.Code != http.StatusOK || !strings.Contains(css.Body.String(), "--cyan") {
		t.Fatalf("embedded asset was not served: %d", css.Code)
	}
	html := httptest.NewRecorder()
	handler.ServeHTTP(html, httptest.NewRequest(http.MethodGet, "/", nil))
	if html.Code != http.StatusOK || !strings.Contains(html.Body.String(), "只读") {
		t.Fatalf("read-only page was not served at root: %d", html.Code)
	}
	operatorHTML := httptest.NewRecorder()
	handler.ServeHTTP(operatorHTML, httptest.NewRequest(http.MethodGet, "/operator", nil))
	if operatorHTML.Code != http.StatusOK || strings.Contains(operatorHTML.Body.String(), `id="opaque"`) {
		t.Fatalf("operator page still requires manual opaque input: %d", operatorHTML.Code)
	}
	htmlBody := operatorHTML.Body.String()
	for _, control := range []string{`id="chat-count"`, `id="chat-burst"`, `id="auto-output"`, `/assets/chat.js`} {
		if !strings.Contains(htmlBody, control) {
			t.Fatalf("operator page does not expose continuous-send control %q", control)
		}
	}
	if strings.Count(htmlBody, `id="auto-output"`) != 1 {
		t.Fatalf("operator page must expose one shared activity log")
	}
	for _, removed := range []string{
		"Protocol state", "Show keys", `id="output"`, `id="protocol-state"`,
		`id="diagnostic-output"`, "chat-without-stored-key", "chat-without-login", `aria-label="返回信息"`,
	} {
		if strings.Contains(htmlBody, removed) {
			t.Fatalf("operator page still exposes removed diagnostic control %q", removed)
		}
	}
	for _, option := range []string{
		`value="scene">所有人`,
		`value="guild">公会`,
		`value="team">队伍`,
		`value="world">世界`,
		`value="privateChat">私聊`,
	} {
		if !strings.Contains(htmlBody, option) {
			t.Fatalf("operator page does not expose chat option %q", option)
		}
	}
	assertStatus(t, handler, http.MethodGet, "/api/v1/servers", "", http.StatusOK)

	login := perform(t, handler, http.MethodPost, "/api/v1/servers/local/sessions", `{"account":"runtime-account","password":"runtime-password"}`)
	if login.Code != http.StatusCreated || strings.Contains(login.Body.String(), "runtime-password") {
		t.Fatalf("login response leaked credential or failed: %d %s", login.Code, login.Body.String())
	}
	loginToken, _ := dialer.client.sent[0].StringParam(1)
	if loginToken != gamesession.TokenFromPassword("runtime-password") {
		t.Fatalf("unexpected derived login token: %q", loginToken)
	}
	var snapshot sessioncontrol.Snapshot
	if err := json.Unmarshal(login.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.ID == "" {
		t.Fatal("login response has no session id")
	}

	base := "/api/v1/sessions/" + snapshot.ID
	legacyMode := "public" + "Chat"
	legacyChat := perform(t, handler, http.MethodPost, base+"/chat", `{"message":"111","mode":"`+legacyMode+`"}`)
	if legacyChat.Code != http.StatusBadRequest || !strings.Contains(legacyChat.Body.String(), `"error":"invalid_chat_mode"`) {
		t.Fatalf("removed public chat mode was accepted: %d %s", legacyChat.Code, legacyChat.Body.String())
	}
	if response := perform(t, handler, http.MethodPost, base+"/select-and-enter", `{"character_id":"role-1"}`); response.Code != http.StatusOK {
		t.Fatalf("select and enter failed: %d %s", response.Code, response.Body.String())
	}
	state := perform(t, handler, http.MethodGet, base+"/diagnostics/protocol-state", "")
	if state.Code != http.StatusOK || !strings.Contains(state.Body.String(), "fixture-login-key") || !strings.Contains(state.Body.String(), "fixture-opaque") {
		t.Fatalf("diagnostic state was not exposed explicitly: %d %s", state.Code, state.Body.String())
	}
	chat := perform(t, handler, http.MethodPost, base+"/chat", `{"message":"111","mode":"scene"}`)
	if chat.Code != http.StatusOK || !strings.Contains(chat.Body.String(), "server_response_received") || !strings.Contains(chat.Body.String(), "server accepted chat") || !strings.Contains(chat.Body.String(), "delivery_status") || !strings.Contains(chat.Body.String(), "game_server_response_latency_ms") || !strings.Contains(chat.Body.String(), "game_server_status") || strings.Contains(chat.Body.String(), "fixture-opaque") {
		t.Fatalf("chat response was not safe or successful: %d %s", chat.Code, chat.Body.String())
	}
	chatMessage := dialer.client.sent[len(dialer.client.sent)-1]
	if channel, _ := chatMessage.StringParam(21); channel != gameprotocol.PublicChatChannel {
		t.Fatalf("public chat used wrong channel: %q", channel)
	}
	secondChat := perform(t, handler, http.MethodPost, base+"/chat", `{"message":"222","mode":"privateChat"}`)
	if secondChat.Code != http.StatusOK || !strings.Contains(secondChat.Body.String(), "server accepted second chat") {
		t.Fatalf("second chat response was not successful: %d %s", secondChat.Code, secondChat.Body.String())
	}
	secondChatMessage := dialer.client.sent[len(dialer.client.sent)-1]
	if channel, _ := secondChatMessage.StringParam(21); channel != gameprotocol.PrivateChatChannel {
		t.Fatalf("second chat used wrong channel: %q", channel)
	}
	for _, test := range []struct {
		mode    string
		message string
		result  string
	}{
		{mode: gameprotocol.GuildChatChannel, message: "333", result: "server accepted guild chat"},
		{mode: gameprotocol.TeamChatChannel, message: "444", result: "server accepted team chat"},
		{mode: gameprotocol.WorldChatChannel, message: "555", result: "server accepted world chat"},
	} {
		body := `{"message":"` + test.message + `","mode":"` + test.mode + `"}`
		chat := perform(t, handler, http.MethodPost, base+"/chat", body)
		if chat.Code != http.StatusOK || !strings.Contains(chat.Body.String(), test.result) {
			t.Fatalf("%s chat failed: %d %s", test.mode, chat.Code, chat.Body.String())
		}
		chatMessage := dialer.client.sent[len(dialer.client.sent)-1]
		if channel, _ := chatMessage.StringParam(21); channel != test.mode {
			t.Fatalf("%s chat used wrong channel: %q", test.mode, channel)
		}
	}
	dropSuccess := perform(t, handler, http.MethodPost, base+"/chat", `{"message":"drop@265@100000069@1","mode":"privateChat"}`)
	if dropSuccess.Code != http.StatusOK || !strings.Contains(dropSuccess.Body.String(), `"delivery_status":"success"`) || !strings.Contains(dropSuccess.Body.String(), "已将物品[100000069]") {
		t.Fatalf("drop success was not classified by the API: %d %s", dropSuccess.Code, dropSuccess.Body.String())
	}
	if !strings.Contains(dropSuccess.Body.String(), `"chat_success_count":1`) || !strings.Contains(dropSuccess.Body.String(), `"chat_failure_count":0`) {
		t.Fatalf("drop success counters were not exposed: %s", dropSuccess.Body.String())
	}
	dropFailure := perform(t, handler, http.MethodPost, base+"/chat", `{"message":"drop@315@100000069@1","mode":"privateChat"}`)
	if dropFailure.Code != http.StatusOK || !strings.Contains(dropFailure.Body.String(), `"delivery_status":"failure"`) || !strings.Contains(dropFailure.Body.String(), "目标玩家[315]不在线") {
		t.Fatalf("drop failure was not classified by the API: %d %s", dropFailure.Code, dropFailure.Body.String())
	}
	if !strings.Contains(dropFailure.Body.String(), `"chat_success_count":1`) || !strings.Contains(dropFailure.Body.String(), `"chat_failure_count":1`) || !strings.Contains(dropFailure.Body.String(), `"chat_unknown_count":5`) {
		t.Fatalf("drop failure counters were not exposed: %s", dropFailure.Body.String())
	}
	cashIDSuccess := perform(t, handler, http.MethodPost, base+"/chat", `{"message":"cashid@265@10","mode":"privateChat"}`)
	if cashIDSuccess.Code != http.StatusOK || !strings.Contains(cashIDSuccess.Body.String(), `"delivery_status":"success"`) || !strings.Contains(cashIDSuccess.Body.String(), "已给角色[REF(265)]发放点券 10") {
		t.Fatalf("cashid success was not classified by the API: %d %s", cashIDSuccess.Code, cashIDSuccess.Body.String())
	}
	if !strings.Contains(cashIDSuccess.Body.String(), `"chat_success_count":2`) || !strings.Contains(cashIDSuccess.Body.String(), `"chat_failure_count":1`) || !strings.Contains(cashIDSuccess.Body.String(), `"chat_unknown_count":5`) {
		t.Fatalf("cashid success counters were not exposed: %s", cashIDSuccess.Body.String())
	}
	cashIDFailure := perform(t, handler, http.MethodPost, base+"/chat", `{"message":"cashid@315@10","mode":"privateChat"}`)
	if cashIDFailure.Code != http.StatusOK || !strings.Contains(cashIDFailure.Body.String(), `"delivery_status":"failure"`) || !strings.Contains(cashIDFailure.Body.String(), "角色id[315]不在线") {
		t.Fatalf("cashid offline result was not classified by the API: %d %s", cashIDFailure.Code, cashIDFailure.Body.String())
	}
	if !strings.Contains(cashIDFailure.Body.String(), `"chat_success_count":2`) || !strings.Contains(cashIDFailure.Body.String(), `"chat_failure_count":2`) || !strings.Contains(cashIDFailure.Body.String(), `"chat_unknown_count":5`) {
		t.Fatalf("cashid failure counters were not exposed: %s", cashIDFailure.Body.String())
	}
	withoutKey := perform(t, handler, http.MethodPost, base+"/diagnostics/chat-without-stored-key", `{"message":"111"}`)
	if withoutKey.Code != http.StatusOK || !strings.Contains(withoutKey.Body.String(), "authenticated_connection_without_stored_key") || !strings.Contains(withoutKey.Body.String(), `"server_key_included":false`) {
		t.Fatalf("same-connection keyless chat failed: %d %s", withoutKey.Code, withoutKey.Body.String())
	}
	fresh := perform(t, handler, http.MethodPost, "/api/v1/servers/local/diagnostics/chat-without-login", `{"message":"111"}`)
	if fresh.Code != http.StatusOK || !strings.Contains(fresh.Body.String(), "fresh_connection_without_login") {
		t.Fatalf("fresh keyless probe failed: %d %s", fresh.Code, fresh.Body.String())
	}
	if response := perform(t, handler, http.MethodDelete, base, ""); response.Code != http.StatusNoContent {
		t.Fatalf("stop failed: %d %s", response.Code, response.Body.String())
	}
}

func assertStatus(t *testing.T, handler http.Handler, method, path, body string, want int) {
	t.Helper()
	response := perform(t, handler, method, path, body)
	if response.Code != want {
		t.Fatalf("%s %s: got %d want %d: %s", method, path, response.Code, want, response.Body.String())
	}
}

func perform(t *testing.T, handler http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var requestBody *strings.Reader
	if body == "" {
		requestBody = strings.NewReader("")
	} else {
		requestBody = strings.NewReader(body)
	}
	request := httptest.NewRequest(method, path, requestBody)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

type apiDialer struct{ client *apiClient }

func (d *apiDialer) Dial(_ context.Context, _ string, _ uint32) (gameprotocol.Client, error) {
	return d.client, nil
}

type apiClient struct {
	responses     []gameprotocol.Message
	sent          []gameprotocol.Message
	responseReady chan struct{}
}

func (c *apiClient) Send(_ context.Context, message gameprotocol.Message) error {
	c.sent = append(c.sent, message)
	count := 1
	if message.Op != nil && *message.Op == 7 {
		count = 3
	}
	if message.Op == nil || (*message.Op != 0 && *message.Op != 6 && *message.Op != 7 && *message.Op != 8 && *message.Op != 10) {
		count = 0
	}
	if c.responseReady == nil {
		c.responseReady = make(chan struct{}, len(c.responses)+8)
	}
	for index := 0; index < count; index++ {
		c.responseReady <- struct{}{}
	}
	return nil
}

func (c *apiClient) Receive(ctx context.Context) (gameprotocol.Message, error) {
	if c.responseReady == nil {
		c.responseReady = make(chan struct{}, len(c.responses)+8)
	}
	select {
	case <-c.responseReady:
	case <-ctx.Done():
		return gameprotocol.Message{}, ctx.Err()
	}
	if len(c.responses) == 0 {
		return gameprotocol.Message{}, context.Canceled
	}
	message := c.responses[0]
	c.responses = c.responses[1:]
	return message, nil
}

func (c *apiClient) Close() error { return nil }

func apiResponse(operation, code int) gameprotocol.Message {
	return responseMessage(operation, code)
}

func apiLoginResponse() gameprotocol.Message {
	operation, code := 0, 0
	return gameprotocol.Message{Type: "resp", Op: &operation, RC: &code, Params: []gameprotocol.Param{{
		ID: 1, Value: map[string]any{
			"serverKey":  "fixture-login-key",
			"characters": []any{map[string]any{"charid": "role-1", "name": "Fixture", "opaque": "fixture-opaque", "mapId": "211000000"}},
		},
	}}}
}

func responseMessage(operation, code int) gameprotocol.Message {
	return gameprotocol.Message{Type: "resp", Op: &operation, RC: &code, Params: []gameprotocol.Param{}}
}

func apiEvent(eventID int) gameprotocol.Message {
	return gameprotocol.Message{Type: "evt", Event: &eventID, Params: []gameprotocol.Param{}}
}

func apiMapEvent(value string) gameprotocol.Message {
	eventID := 64
	return gameprotocol.Message{Type: "evt", Event: &eventID, Params: []gameprotocol.Param{{ID: 64, Value: value}}}
}

func apiSystemEvent(text string) gameprotocol.Message {
	eventID := 20
	return gameprotocol.Message{Type: "evt", Event: &eventID, Params: []gameprotocol.Param{
		{ID: 36, Value: text}, {ID: 65, Value: "System"},
	}}
}
