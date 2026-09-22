package operatorapi

import (
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"strings"

	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

type loginRequest struct {
	Account        string `json:"account"`
	Password       string `json:"password"`
	Token          string `json:"token"`
	CredentialType string `json:"credential_type"`
	// Deprecated compatibility fields. The backend ignores them and always
	// sends the fixed heartbeat defined by the game-session module.
	Heartbeat                *bool `json:"heartbeat"`
	HeartbeatOperation       int   `json:"heartbeat_operation"`
	HeartbeatIntervalSeconds int   `json:"heartbeat_interval_seconds"`
}

type selectRequest struct {
	CharacterID string `json:"character_id"`
	Opaque      string `json:"opaque"`
}

type chatRequest struct {
	Message string `json:"message"`
	Mode    string `json:"mode"`
}

type chatResponse struct {
	Status                      string                  `json:"status"`
	Message                     string                  `json:"message"`
	ServerResponse              string                  `json:"server_response,omitempty"`
	ServerResponseType          string                  `json:"server_response_type,omitempty"`
	ServerResponseObserved      bool                    `json:"server_response_observed"`
	ServerResponseCode          *int                    `json:"server_response_code,omitempty"`
	ServerEvent                 int                     `json:"server_event,omitempty"`
	DeliveryStatus              string                  `json:"delivery_status"`
	ServerKeyIncluded           bool                    `json:"server_key_included"`
	ConnectionMode              string                  `json:"connection_mode"`
	GameServerResponseLatencyMS int64                   `json:"game_server_response_latency_ms"`
	GameServerStatus            string                  `json:"game_server_status"`
	Session                     sessioncontrol.Snapshot `json:"session"`
}

type apiError struct {
	Error string `json:"error"`
}

func decodeJSON(writer http.ResponseWriter, request *http.Request, target any) error {
	request.Body = http.MaxBytesReader(writer, request.Body, 256*1024)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_json"})
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_json"})
		return errors.New("request contains more than one JSON value")
	}
	return nil
}

func writeDomainError(writer http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	code := gamesession.ErrorCode(err)
	switch {
	case errors.Is(err, sessioncontrol.ErrServerNotFound), errors.Is(err, sessioncontrol.ErrSessionNotFound):
		status, code = http.StatusNotFound, "not_found"
	case errors.Is(err, sessioncontrol.ErrServerDisabled):
		status, code = http.StatusConflict, "server_disabled"
	case errors.Is(err, sessioncontrol.ErrCapacityFull):
		status, code = http.StatusTooManyRequests, "capacity_full"
	case errors.Is(err, sessioncontrol.ErrManagerClosed), errors.Is(err, gamesession.ErrClosed):
		status, code = http.StatusGone, "closed"
	case errors.Is(err, sessioncontrol.ErrKeylessProbeDenied):
		status, code = http.StatusForbidden, "keyless_probe_disabled"
	case errors.Is(err, gamesession.ErrMissingCredential), errors.Is(err, gamesession.ErrMissingRoleOpaque):
		status = http.StatusBadRequest
	case errors.Is(err, gamesession.ErrMissingCharacter), errors.Is(err, gamesession.ErrRoleSelectionRequired):
		status = http.StatusBadRequest
	case errors.Is(err, gamesession.ErrInvalidState):
		status = http.StatusConflict
	case errors.Is(err, gamesession.ErrTimeout), errors.Is(err, gamesession.ErrMapInitializationTimeout):
		status = http.StatusGatewayTimeout
	}
	writeJSON(writer, status, apiError{Error: code})
}

func methodNotAllowed(writer http.ResponseWriter, methods ...string) {
	writer.Header().Set("Allow", strings.Join(methods, ", "))
	writeJSON(writer, http.StatusMethodNotAllowed, apiError{Error: "method_not_allowed"})
}

func pathParts(path string) []string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return nil
	}
	return strings.Split(trimmed, "/")
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}

func fsHandler() (http.Handler, error) {
	root, err := fs.Sub(assetFS, "assets")
	if err != nil {
		return nil, err
	}
	return http.FileServer(http.FS(root)), nil
}
