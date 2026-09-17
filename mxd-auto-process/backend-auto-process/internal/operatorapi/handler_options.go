package operatorapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"net/http"
	"sync"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

const (
	serviceTokenHeader = "Authorization"
	operatorCookie     = "mxd_auto_operator"
	sessionLifetime    = 12 * time.Hour
)

type Options struct {
	Store                 *autostore.Store
	Accounts              *sessioncontrol.AccountManager
	ServiceToken          string
	SecureCookie          bool
	LegacyUnauthenticated bool
}

type operatorSession struct {
	Username   string
	ExpiresAt  time.Time
	MustChange bool
}

type loginFailure struct {
	windowStarted time.Time
	count         int
	blockedUntil  time.Time
}

func (h *Handler) configure(options Options) {
	h.store = options.Store
	h.accounts = options.Accounts
	h.serviceToken = options.ServiceToken
	h.secureCookie = options.SecureCookie
	h.legacyUnauthenticated = options.LegacyUnauthenticated
	h.operatorSessions = make(map[string]operatorSession)
	h.loginFailures = make(map[string]loginFailure)
}

func (h *Handler) isServiceRequest(request *http.Request) bool {
	if h.serviceToken == "" {
		return false
	}
	value := request.Header.Get(serviceTokenHeader)
	const prefix = "Bearer "
	if len(value) <= len(prefix) || value[:len(prefix)] != prefix {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(value[len(prefix):]), []byte(h.serviceToken)) == 1
}

func (h *Handler) operatorIdentity(request *http.Request) (operatorSession, bool) {
	cookie, err := request.Cookie(operatorCookie)
	if err != nil || cookie.Value == "" {
		return operatorSession{}, false
	}
	h.operatorMu.Lock()
	session, ok := h.operatorSessions[cookie.Value]
	if ok && time.Now().After(session.ExpiresAt) {
		delete(h.operatorSessions, cookie.Value)
		ok = false
	}
	h.operatorMu.Unlock()
	return session, ok
}

func (h *Handler) authorized(request *http.Request, allowPasswordChange bool) (operatorSession, bool) {
	if h.legacyUnauthenticated {
		return operatorSession{}, true
	}
	if h.isServiceRequest(request) {
		return operatorSession{Username: "service"}, true
	}
	session, ok := h.operatorIdentity(request)
	if !ok {
		return operatorSession{}, false
	}
	if session.MustChange && !allowPasswordChange {
		return session, false
	}
	return session, true
}

func (h *Handler) newOperatorSession(username string, mustChange bool) (string, operatorSession, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", operatorSession{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	session := operatorSession{Username: username, MustChange: mustChange, ExpiresAt: time.Now().Add(sessionLifetime)}
	h.operatorMu.Lock()
	h.operatorSessions[token] = session
	h.operatorMu.Unlock()
	return token, session, nil
}

func (h *Handler) setOperatorCookie(writer http.ResponseWriter, token string) {
	http.SetCookie(writer, &http.Cookie{Name: operatorCookie, Value: token, Path: "/", HttpOnly: true, Secure: h.secureCookie, SameSite: http.SameSiteStrictMode, MaxAge: int(sessionLifetime.Seconds())})
}

func (h *Handler) clearOperatorCookie(writer http.ResponseWriter) {
	http.SetCookie(writer, &http.Cookie{Name: operatorCookie, Value: "", Path: "/", HttpOnly: true, Secure: h.secureCookie, SameSite: http.SameSiteStrictMode, MaxAge: -1})
}

var _ sync.Locker
