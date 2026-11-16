package operatorapi

import (
	"errors"
	"net/http"

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

// ServeHTTP reserves quota before audit/parsing, then this serializes verification with
// loginMu. Lock order is loginMu -> store/operatorMu; other paths never reverse it.
// The recheck prevents already-admitted concurrent requests from passing a ban.
func (h *Handler) operatorLogin(writer http.ResponseWriter, request *http.Request) {
	ip, _ := clientIP(request) // ServeHTTP has already rejected invalid/IPv6 peers.
	key := ip.String()
	var input operatorLoginRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	h.loginMu.Lock()
	defer h.loginMu.Unlock()
	if !h.accessAllowed(writer, request) {
		return
	}
	entry := h.loginFailures[key]
	// A body that outlived its reserved window must reserve again in a new request.
	if entry == nil {
		writeJSON(writer, http.StatusRequestTimeout, apiError{Error: "login_request_expired"})
		return
	}
	if checkTemporaryBan(writer, entry, h.loginNow()) {
		return
	}
	valid, mustChange, err := h.store.VerifyOperator(input.Username, input.Password)
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "operator_auth_unavailable"})
		return
	}
	if !valid {
		count, err := h.store.RecordIPFailure(key, permanentFailureLimit+1, maxFailureIPs)
		if err != nil {
			writeJSON(writer, http.StatusServiceUnavailable, apiError{Error: "operator_auth_unavailable"})
			return
		}
		if count > permanentFailureLimit {
			writePermanentBan(writer)
			return
		}
		entry.count++
		if entry.count >= maxLoginFailures {
			entry.blockedUntil = h.loginNow().Add(loginBlockDuration)
			checkTemporaryBan(writer, entry, h.loginNow())
			return
		}
		writeJSON(writer, http.StatusUnauthorized, apiError{Error: "invalid_operator_credentials"})
		return
	}
	entry.count = 0 // Lifetime total and request quota are intentionally preserved.
	token, session, err := h.newOperatorSession(input.Username, mustChange)
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "operator_auth_unavailable"})
		return
	}
	h.setOperatorCookie(writer, token)
	writeJSON(writer, http.StatusOK, operatorSessionResponse(session))
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
