package operatorapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
)

type auditBodyContextKey struct{}

const maxAuditBodyBytes = 32 * 1024

func requestWithAuditBody(request *http.Request) *http.Request {
	if request.Body == nil || request.ContentLength == 0 {
		return request
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, maxAuditBodyBytes+1))
	if err != nil {
		return request
	}
	request.Body = io.NopCloser(bytes.NewReader(body))
	return request.WithContext(context.WithValue(request.Context(), auditBodyContextKey{}, body))
}

type auditResponseWriter struct {
	http.ResponseWriter
	status    int
	body      bytes.Buffer
	truncated bool
}

func (w *auditResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *auditResponseWriter) Write(data []byte) (int, error) {
	remaining := maxAuditBodyBytes - w.body.Len()
	if remaining > 0 {
		captured := data
		if len(captured) > remaining {
			captured = captured[:remaining]
		}
		_, _ = w.body.Write(captured)
	}
	if len(data) > remaining {
		w.truncated = true
	}
	return w.ResponseWriter.Write(data)
}

func (w *auditResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func AuditEntryForRequest(request *http.Request, status int, duration time.Duration, responseBody []byte, responseTruncated bool) autostore.AuditEntry {
	requestID := request.Header.Get("X-Request-ID")
	if requestID == "" {
		requestID = auditID()
	}
	actor := request.Header.Get("X-Ops-Actor-ID")
	if actor == "" {
		if cookie, err := request.Cookie(operatorCookie); err == nil {
			actor = "operator-session"
			_ = cookie
		}
	}
	detail := map[string]any{}
	if request.URL.RawQuery != "" {
		detail["query"] = request.URL.RawQuery
	}
	if request.ContentLength >= 0 {
		detail["content_length"] = request.ContentLength
	}
	if body, ok := request.Context().Value(auditBodyContextKey{}).([]byte); ok && len(body) > 0 {
		captureAuditPayload(detail, "request", body, len(body) > maxAuditBodyBytes)
	}
	if len(responseBody) > 0 {
		captureAuditPayload(detail, "response", responseBody, responseTruncated)
	}
	if serverID := auditServerID(request.URL.Path, detail["response_body"]); serverID != "" {
		detail["server_id"] = serverID
	}
	if accountID := auditAccountID(request.URL.Path, detail["response_body"]); accountID != "" {
		detail["account_id"] = accountID
	}
	return autostore.AuditEntry{ID: auditID(), RequestID: requestID, Method: request.Method, Path: request.URL.Path, Actor: actor, Action: actionName(request), Status: status, DurationMS: duration.Milliseconds(), Detail: detail}
}

func auditAccountID(path string, response any) string {
	parts := pathParts(path)
	for index := 0; index+1 < len(parts); index++ {
		if parts[index] == "accounts" && parts[index+1] != "" {
			return parts[index+1]
		}
	}
	return nestedAccountID(response)
}

func nestedAccountID(value any) string {
	switch current := value.(type) {
	case map[string]any:
		if id, ok := current["selected_account_id"].(string); ok && id != "" {
			return id
		}
		if _, ok := current["server_id"].(string); ok {
			if id, ok := current["id"].(string); ok {
				return id
			}
		}
		if account, ok := current["account"].(map[string]any); ok {
			if id, ok := account["id"].(string); ok {
				return id
			}
		}
		for _, nested := range current {
			if id := nestedAccountID(nested); id != "" {
				return id
			}
		}
	case []any:
		for _, nested := range current {
			if id := nestedAccountID(nested); id != "" {
				return id
			}
		}
	}
	return ""
}

func captureAuditPayload(detail map[string]any, prefix string, body []byte, truncated bool) {
	if truncated {
		detail[prefix+"_body_truncated"] = true
		if len(body) > maxAuditBodyBytes {
			body = body[:maxAuditBodyBytes]
		}
	}
	var payload any
	if err := json.Unmarshal(body, &payload); err == nil {
		detail[prefix+"_body"] = redactAuditValue(payload)
		return
	}
	detail[prefix+"_body_bytes"] = len(body)
}

func redactAuditValue(value any) any {
	switch current := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(current))
		for key, item := range current {
			if sensitiveAuditField(key) {
				result[key] = "[redacted]"
				continue
			}
			result[key] = redactAuditValue(item)
		}
		return result
	case []any:
		result := make([]any, len(current))
		for index, item := range current {
			result[index] = redactAuditValue(item)
		}
		return result
	default:
		return value
	}
}

func sensitiveAuditField(key string) bool {
	lower := strings.ToLower(key)
	return strings.Contains(lower, "password") || strings.Contains(lower, "token") ||
		strings.Contains(lower, "secret") || strings.Contains(lower, "credential") ||
		strings.Contains(lower, "authorization") || lower == "serverkey" ||
		lower == "server_key" || lower == "selected_role_opaque" || lower == "opaque"
}

func auditServerID(path string, response any) string {
	parts := pathParts(path)
	if len(parts) >= 4 && parts[0] == "api" && parts[1] == "v1" && parts[2] == "servers" {
		return parts[3]
	}
	return nestedServerID(response)
}

func nestedServerID(value any) string {
	switch current := value.(type) {
	case map[string]any:
		if serverID, ok := current["server_id"].(string); ok {
			return serverID
		}
		for _, nested := range current {
			if serverID := nestedServerID(nested); serverID != "" {
				return serverID
			}
		}
	case []any:
		for _, nested := range current {
			if serverID := nestedServerID(nested); serverID != "" {
				return serverID
			}
		}
	}
	return ""
}

func shouldAudit(path string) bool {
	if !strings.HasPrefix(path, "/api/v1/") {
		return false
	}
	for _, ignored := range []string{"/overview", "/logs", "/events", "/healthz", "/operator/me"} {
		if strings.HasSuffix(path, ignored) {
			return false
		}
	}
	return true
}

func actionName(request *http.Request) string {
	path := request.URL.Path
	if description := describedAction(request.Method, path); description != "" {
		return description
	}
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) > 3 {
		return request.Method + " " + strings.Join(parts[3:], "/")
	}
	return request.Method + " " + strings.Trim(path, "/")
}

func describedAction(method, path string) string {
	switch {
	case path == "/api/v1/operator/login":
		return "登录自动化控制台"
	case path == "/api/v1/operator/logout":
		return "退出自动化控制台"
	case path == "/api/v1/operator/password":
		return "修改管理员密码"
	case path == "/api/v1/servers" && method == http.MethodPost:
		return "添加游戏服务器"
	case strings.HasSuffix(path, "/sessions") && method == http.MethodPost:
		return "登录游戏账号"
	case strings.HasSuffix(path, "/select-and-enter"):
		return "选择角色并进入地图"
	case strings.HasSuffix(path, "/accounts") && method == http.MethodPost:
		return "添加游戏账号"
	case strings.HasSuffix(path, "/start"):
		return "启动游戏账号"
	case strings.HasSuffix(path, "/stop"):
		return "停止游戏账号"
	case strings.HasSuffix(path, "/reconnect"):
		return "重新连接游戏账号"
	case strings.HasSuffix(path, "/message") || strings.HasSuffix(path, "/chat"):
		return "发送游戏消息"
	case method == http.MethodPatch && strings.Contains(path, "/servers/"):
		return "更新服务器或账号"
	case method == http.MethodDelete && strings.Contains(path, "/servers/"):
		return "删除服务器或账号"
	default:
		return ""
	}
}

func auditID() string {
	value := make([]byte, 12)
	if _, err := rand.Read(value); err != nil {
		return time.Now().UTC().Format("20060102150405.000000000")
	}
	return hex.EncodeToString(value)
}
