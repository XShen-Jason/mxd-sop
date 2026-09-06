package player

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
)

func publicAccount(a account) map[string]any {
	return map[string]any{"server": a.Server, "qq": a.QQ, "gameAccount": a.GameAccount, "characters": a.Characters}
}
func decode(r *http.Request, v any) bool {
	return decodeBody(r, v, 32768)
}

func decodeBody(r *http.Request, v any, limit int64) bool {
	if r.ContentLength > limit {
		return false
	}
	decoder := json.NewDecoder(io.LimitReader(r.Body, limit+1))
	if decoder.Decode(v) != nil {
		return false
	}
	var extra any
	return decoder.Decode(&extra) == io.EOF
}
func jsonWrite(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeErr(w http.ResponseWriter, e error) {
	status, code, message := 500, "internal-error", "服务暂不可用"
	switch e.Error() {
	case "method-not-allowed":
		status, code, message = 405, "method-not-allowed", "不支持该请求"
	case "not-found":
		status, code, message = 404, "not-found", "请求地址不存在"
	case "invalid-input":
		status, code, message = 400, "invalid-input", "请检查输入"
	case "unauthorized":
		status, code, message = 401, "unauthorized", "请重新验证"
	case "account-not-found":
		status, code, message = 404, "account-not-found", "未找到匹配账号"
	case "character-not-owned":
		status, code, message = 400, "character-not-owned", "角色不属于该账号"
	case "team-not-found":
		status, code, message = 404, "team-not-found", "邀请码无效"
	case "team-full":
		status, code, message = 409, "team-full", "队伍已满"
	case "already-in-team":
		status, code, message = 409, "already-in-team", "该账号已在此副本入队"
	case "already-applied":
		status, code, message = 409, "already-applied", "already-applied"
	case "leader-cannot-leave":
		status, code, message = 409, "leader-cannot-leave", "队长不能退出队伍"
	case "not-in-team":
		status, code, message = 409, "not-in-team", "你当前不在该队伍中"
	case "leader-locked":
		status, code, message = 409, "leader-locked", "队长队伍已锁定，不能加入同副本的其他队伍"
	case "merge-target-not-found":
		status, code, message = 404, "merge-target-not-found", "合并目标队伍不存在或已锁定"
	case "not-team-leader":
		status, code, message = 403, "not-team-leader", "只有队长可以发起队伍合并"
	case "merge-boss-mismatch":
		status, code, message = 400, "merge-boss-mismatch", "只能合并同一副本、同一服务器的队伍"
	case "merge-already-applied":
		status, code, message = 409, "merge-already-applied", "已经向该队伍提交过合并申请"
	case "merge-request-not-found":
		status, code, message = 404, "merge-request-not-found", "合并申请已处理或已失效"
	case "request-not-found":
		status, code, message = 404, "request-not-found", "request-not-found"
	case "server-mismatch":
		status, code, message = 400, "server-mismatch", "服务器不一致"
	case "rate-limited":
		status, code, message = 429, "rate-limited", "请求过于频繁，请稍后再试"
	}
	jsonWrite(w, status, apiError{code, message})
}
func isUniqueAccountBoss(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "one_active_boss_team_per_account") || strings.Contains(s, "one_boss_team_per_account") || strings.Contains(s, "player_team_members.account_id") || strings.Contains(s, "player_team_members.team_id")
}
func randomToken() string    { b := make([]byte, 32); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func digest(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func newCode() string {
	b := make([]byte, 6)
	for i := range b {
		x := make([]byte, 1)
		_, _ = rand.Read(x)
		b[i] = codeChars[int(x[0])%len(codeChars)]
	}
	return string(b)
}
func contains(a []string, s string) bool {
	for _, x := range a {
		if x == s {
			return true
		}
	}
	return false
}
func validServer(s string) bool { return contains(servers, s) }
func validQQ(s string) bool {
	if len(s) < 5 || len(s) > 16 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
func validGameAccount(s string) bool {
	if len(s) == 0 || len(s) > 64 {
		return false
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z') && !(r >= 'A' && r <= 'Z') && !(r >= '0' && r <= '9') && r != '_' && r != '-' {
			return false
		}
	}
	return true
}
func security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		origin := os.Getenv("PLAYER_CORS_ORIGIN")
		if origin == "" {
			origin = "*"
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func rateLimit(next http.Handler) http.Handler {
	sem := make(chan struct{}, 240)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case sem <- struct{}{}:
			defer func() { <-sem }()
			next.ServeHTTP(w, r)
		default:
			jsonWrite(w, 429, apiError{"rate-limited", "请求过于频繁"})
		}
	})
}
