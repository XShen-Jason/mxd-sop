package operatorapi

import (
	"net/http"
	"strconv"
	"time"
)

const (
	loginRequestWindow = 5 * time.Minute
	loginBlockDuration = 20 * time.Minute
	maxLoginRequests   = 10
	maxLoginFailures   = 5
	maxLoginThrottle   = 10000
)

type loginFailure struct {
	requests     []time.Time
	count        int
	blockedUntil time.Time
}

// All transient state is guarded by loginMu. Admission precedes body parsing.
// Credential verification later takes the same mutex and rechecks bans, so
// concurrent requests cannot verify more than five bad passwords before locking.
func (h *Handler) reserveLogin(writer http.ResponseWriter, key string) bool {
	h.loginMu.Lock()
	defer h.loginMu.Unlock()
	now := h.loginNow()
	if !now.Before(h.loginCleanupAt) {
		for ip, entry := range h.loginFailures {
			expired := len(entry.requests) == 0 || !entry.requests[len(entry.requests)-1].After(now.Add(-loginRequestWindow))
			banExpired := !entry.blockedUntil.IsZero() && !now.Before(entry.blockedUntil)
			if expired && (banExpired || (entry.blockedUntil.IsZero() && entry.count == 0)) {
				delete(h.loginFailures, ip)
			}
		}
		h.loginCleanupAt = now.Add(time.Minute)
	}
	entry := h.loginFailures[key]
	if entry == nil {
		if len(h.loginFailures) >= maxLoginThrottle {
			writeLoginLimit(writer, "operator_login_capacity", time.Minute, http.StatusServiceUnavailable)
			return false
		}
		entry = &loginFailure{}
		h.loginFailures[key] = entry
	}
	if checkTemporaryBan(writer, entry, now) {
		return false
	}
	kept := entry.requests[:0]
	for _, at := range entry.requests {
		if at.After(now.Add(-loginRequestWindow)) {
			kept = append(kept, at)
		}
	}
	entry.requests = kept
	if len(kept) >= maxLoginRequests {
		writeLoginLimit(writer, "operator_login_rate_limited", kept[0].Add(loginRequestWindow).Sub(now), http.StatusTooManyRequests)
		return false
	}
	entry.requests = append(entry.requests, now)
	return true
}

// Caller holds loginMu. Expiry resets only the temporary streak; the store's
// lifetime failure total is independent and is never cleared here or on success.
func checkTemporaryBan(writer http.ResponseWriter, entry *loginFailure, now time.Time) bool {
	if now.Before(entry.blockedUntil) {
		writeLoginLimit(writer, "operator_login_blocked", entry.blockedUntil.Sub(now), http.StatusTooManyRequests)
		return true
	}
	if !entry.blockedUntil.IsZero() {
		entry.blockedUntil = time.Time{}
		entry.count = 0
	}
	return false
}

func writeLoginLimit(writer http.ResponseWriter, code string, duration time.Duration, status int) {
	seconds := int((duration + time.Second - 1) / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	writer.Header().Set("Retry-After", strconv.Itoa(seconds))
	message := "登录请求过于频繁，每 5 分钟最多 10 次"
	if code == "operator_login_blocked" {
		message = "该 IP 登录失败次数过多，已暂停登录 20 分钟"
	}
	if status == http.StatusServiceUnavailable {
		message = "登录服务繁忙，请稍后重试"
	}
	writeJSON(writer, status, map[string]any{"error": code, "message": message, "retryAfterSeconds": seconds})
}
