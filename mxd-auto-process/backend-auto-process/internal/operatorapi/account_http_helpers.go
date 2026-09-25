package operatorapi

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

const maxOperatorBodyBytes = 32 * 1024

var (
	errInvalidOperatorRequest = errors.New("invalid operator request")
	errOperatorBodyTooLarge   = errors.New("operator request body is too large")
)

type serverRequest struct {
	ID          string  `json:"id"`
	Name        *string `json:"name"`
	Address     *string `json:"address"`
	Version     *string `json:"version"`
	MapID       *string `json:"map_id"`
	Enabled     *bool   `json:"enabled"`
	SpawnRate   *int    `json:"spawn_rate"`
	ExpRate     *int    `json:"exp_rate"`
	ExpMax      *int64  `json:"exp_max"`
	DropRate    *int    `json:"drop_rate"`
	MesoRate    *int    `json:"meso_rate"`
	DomainTimes *int    `json:"domain_times"`
}

type accountRequest struct {
	Username          *string `json:"username"`
	Password          *string `json:"password"`
	CredentialType    *string `json:"credential_type"`
	CharacterID       *string `json:"character_id"`
	CharacterName     *string `json:"character_name"`
	Enabled           *bool   `json:"enabled"`
	AutomationEnabled *bool   `json:"automation_enabled"`
	SessionID         *string `json:"session_id"`
}

func decodeAndRead(request *http.Request, target any) error {
	if request.Body == nil {
		return errInvalidOperatorRequest
	}
	body, err := io.ReadAll(io.LimitReader(request.Body, maxOperatorBodyBytes+1))
	if err != nil {
		return errInvalidOperatorRequest
	}
	if len(body) > maxOperatorBodyBytes {
		return errOperatorBodyTooLarge
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errInvalidOperatorRequest
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errInvalidOperatorRequest
	}
	return nil
}

func generatedID(prefix string) string {
	value := make([]byte, 8)
	if _, err := rand.Read(value); err == nil {
		return prefix + "-" + hex.EncodeToString(value)
	}
	return fmt.Sprintf("%s-%d", prefix, time.Now().UTC().UnixNano())
}

func (h *Handler) requireOperator(writer http.ResponseWriter, request *http.Request) bool {
	if _, ok := h.authorized(request, false); ok {
		return true
	}
	if session, ok := h.operatorIdentity(request); ok && session.MustChange && !h.legacyUnauthenticated {
		writeJSON(writer, http.StatusForbidden, apiError{Error: "password_change_required"})
		return false
	}
	writeJSON(writer, http.StatusUnauthorized, apiError{Error: "unauthorized"})
	return false
}

func (h *Handler) accountsRecord(serverID string) (map[string]any, error) {
	accounts, err := h.accounts.List(serverID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"accounts": accounts}, nil
}

func writeAccountError(writer http.ResponseWriter, err error) {
	status, code := http.StatusInternalServerError, "internal_error"
	switch {
	case errors.Is(err, errInvalidOperatorRequest), errors.Is(err, errOperatorBodyTooLarge):
		status, code = http.StatusBadRequest, "invalid_json"
	case errors.Is(err, autostore.ErrAccountNotFound):
		status, code = http.StatusNotFound, "account_not_found"
	case errors.Is(err, autostore.ErrDuplicateAccount):
		status, code = http.StatusConflict, "account_exists"
	case errors.Is(err, autostore.ErrInvalidAccount):
		status, code = http.StatusBadRequest, "invalid_account"
	case errors.Is(err, autostore.ErrInvalidPassword):
		status, code = http.StatusBadRequest, "invalid_password"
	case errors.Is(err, sessioncontrol.ErrAccountDisabled):
		status, code = http.StatusConflict, "account_disabled"
	case errors.Is(err, sessioncontrol.ErrAccountOffline):
		status, code = http.StatusConflict, "account_offline"
	case errors.Is(err, sessioncontrol.ErrServerNotFound), errors.Is(err, sessioncontrol.ErrSessionNotFound):
		status, code = http.StatusNotFound, "not_found"
	case errors.Is(err, sessioncontrol.ErrServerDisabled):
		status, code = http.StatusConflict, "server_disabled"
	case errors.Is(err, sessioncontrol.ErrSessionServerMismatch):
		status, code = http.StatusConflict, "session_server_mismatch"
	case errors.Is(err, sessioncontrol.ErrCapacityFull):
		status, code = http.StatusTooManyRequests, "capacity_full"
	case errors.Is(err, gamesession.ErrInvalidState):
		status, code = http.StatusConflict, "invalid_state"
	case errors.Is(err, gamesession.ErrTimeout), errors.Is(err, gamesession.ErrMapInitializationTimeout):
		status, code = http.StatusGatewayTimeout, gamesession.ErrorCode(err)
	case errors.Is(err, gamesession.ErrClosed):
		status, code = http.StatusGone, "closed"
	default:
		if value := gamesession.ErrorCode(err); value != "transport_error" {
			status, code = http.StatusBadGateway, value
		}
	}
	writeJSON(writer, status, apiError{Error: code})
}

func normalizeOptionalText(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
