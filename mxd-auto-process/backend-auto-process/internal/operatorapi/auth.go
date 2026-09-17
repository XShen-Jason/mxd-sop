package operatorapi

import (
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
)

type operatorLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

const (
	loginFailureWindow = time.Minute
	loginBlockDuration = time.Minute
	maxLoginFailures   = 5
	maxLoginThrottle   = 4096
)

func (h *Handler) operatorLogin(writer http.ResponseWriter, request *http.Request) {
	var input operatorLoginRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	key := loginThrottleKey(request, input.Username)
	if allowed, retryAfter := h.allowLogin(key); !allowed {
		writer.Header().Set("Retry-After", retryAfterSeconds(retryAfter))
		writeJSON(writer, http.StatusTooManyRequests, apiError{Error: "operator_login_rate_limited"})
		return
	}
	valid, mustChange, err := h.store.VerifyOperator(input.Username, input.Password)
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "operator_auth_unavailable"})
		return
	}
	if !valid {
		h.recordLoginFailure(key)
		writeJSON(writer, http.StatusUnauthorized, apiError{Error: "invalid_operator_credentials"})
		return
	}
	h.clearLoginFailures(key)
	token, session, err := h.newOperatorSession(input.Username, mustChange)
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "operator_auth_unavailable"})
		return
	}
	h.setOperatorCookie(writer, token)
	writeJSON(writer, http.StatusOK, operatorSessionResponse(session))
}

func (h *Handler) allowLogin(key string) (bool, time.Duration) {
	now := time.Now()
	h.operatorMu.Lock()
	defer h.operatorMu.Unlock()
	entry, ok := h.loginFailures[key]
	if !ok {
		if len(h.loginFailures) >= maxLoginThrottle {
			return false, loginBlockDuration
		}
		return true, 0
	}
	if !entry.blockedUntil.IsZero() && now.Before(entry.blockedUntil) {
		return false, time.Until(entry.blockedUntil)
	}
	if now.Sub(entry.windowStarted) >= loginFailureWindow {
		delete(h.loginFailures, key)
	}
	return true, 0
}

func (h *Handler) recordLoginFailure(key string) {
	now := time.Now()
	h.operatorMu.Lock()
	defer h.operatorMu.Unlock()
	entry := h.loginFailures[key]
	if entry.windowStarted.IsZero() || now.Sub(entry.windowStarted) >= loginFailureWindow {
		entry = loginFailure{windowStarted: now}
	}
	entry.count++
	if entry.count >= maxLoginFailures {
		entry.blockedUntil = now.Add(loginBlockDuration)
	}
	h.loginFailures[key] = entry
}

func (h *Handler) clearLoginFailures(key string) {
	h.operatorMu.Lock()
	delete(h.loginFailures, key)
	h.operatorMu.Unlock()
}

func loginThrottleKey(request *http.Request, username string) string {
	host := request.RemoteAddr
	if value, _, err := net.SplitHostPort(request.RemoteAddr); err == nil {
		host = value
	}
	return strings.ToLower(strings.TrimSpace(host)) + "\x00" + strings.ToLower(strings.TrimSpace(username))
}

func retryAfterSeconds(duration time.Duration) string {
	seconds := int(duration / time.Second)
	if duration%time.Second != 0 {
		seconds++
	}
	if seconds < 1 {
		seconds = 1
	}
	return strconv.Itoa(seconds)
}

func (h *Handler) operatorMe(writer http.ResponseWriter, request *http.Request) {
	session, ok := h.operatorIdentity(request)
	if !ok {
		writeJSON(writer, http.StatusUnauthorized, apiError{Error: "unauthorized"})
		return
	}
	writeJSON(writer, http.StatusOK, operatorSessionResponse(session))
}

func (h *Handler) operatorChangePassword(writer http.ResponseWriter, request *http.Request) {
	session, ok := h.authorized(request, true)
	if !ok || session.Username == "service" {
		writeJSON(writer, http.StatusUnauthorized, apiError{Error: "unauthorized"})
		return
	}
	var input changePasswordRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if err := h.store.ChangeOperatorPassword(session.Username, input.CurrentPassword, input.NewPassword); err != nil {
		status := http.StatusBadRequest
		if !errors.Is(err, autostore.ErrInvalidPassword) {
			status = http.StatusInternalServerError
		}
		writeJSON(writer, status, apiError{Error: "invalid_operator_password"})
		return
	}
	cookie, _ := request.Cookie(operatorCookie)
	h.operatorMu.Lock()
	updated := h.operatorSessions[cookie.Value]
	updated.MustChange = false
	h.operatorSessions[cookie.Value] = updated
	h.operatorMu.Unlock()
	writeJSON(writer, http.StatusOK, operatorSessionResponse(updated))
}

func (h *Handler) operatorLogout(writer http.ResponseWriter, request *http.Request) {
	if cookie, err := request.Cookie(operatorCookie); err == nil {
		h.operatorMu.Lock()
		delete(h.operatorSessions, cookie.Value)
		h.operatorMu.Unlock()
	}
	h.clearOperatorCookie(writer)
	writer.WriteHeader(http.StatusNoContent)
}

func operatorSessionResponse(session operatorSession) map[string]any {
	return map[string]any{"user": map[string]string{"username": session.Username}, "must_change": session.MustChange, "expires_at": session.ExpiresAt.UTC().Format("2006-01-02T15:04:05.999999999Z07:00")}
}
