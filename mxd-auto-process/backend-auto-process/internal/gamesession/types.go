package gamesession

import (
	"errors"
	"fmt"
	"time"
)

type State string

const (
	StateNew            State = "new"
	StateAuthenticating State = "authenticating"
	StateLoggedIn       State = "logged_in"
	StateSelecting      State = "selecting"
	StateCharacterReady State = "character_selected"
	StateEntering       State = "entering_map"
	StateReady          State = "ready"
	StateReconnecting   State = "reconnecting"
	StateFailed         State = "failed"
	StateClosed         State = "closed"
)

const (
	FixedHeartbeatOperation = 19
	FixedHeartbeatInterval  = 10 * time.Second
)

type RetentionMode string

const (
	RetainSessionData RetentionMode = "session"
	RetainMinimal     RetentionMode = "minimal"
)

var (
	ErrInvalidState             = errors.New("invalid session state")
	ErrMissingCredential        = errors.New("missing credential")
	ErrMissingCharacter         = errors.New("missing character id")
	ErrRoleSelectionRequired    = errors.New("a role must be selected")
	ErrMissingRoleOpaque        = errors.New("missing role opaque value")
	ErrRoleOpaqueAmbiguous      = errors.New("multiple role opaque values found")
	ErrTimeout                  = errors.New("operation timeout")
	ErrMapInitializationTimeout = errors.New("map initialization timeout")
	ErrRemote                   = errors.New("remote operation failed")
	ErrProtocol                 = errors.New("protocol error")
	ErrClosed                   = errors.New("session is closed")
	ErrKickedOut                = errors.New("kicked out: account logged in elsewhere")
	ErrConnectionLost           = errors.New("connection lost")
)

type Credentials struct {
	Account  string
	Password string
	Token    string
}

type RoleOption struct {
	ID              string `json:"id"`
	Name            string `json:"name,omitempty"`
	MapID           string `json:"map_id,omitempty"`
	OpaqueAvailable bool   `json:"opaque_available"`
}

type LoginResult struct {
	Roles           []RoleOption
	ServerKeyStored bool
}

const (
	ChatStatusWrittenUnconfirmed = "written_unconfirmed"
	ChatStatusServerResponse     = "server_response_received"
	ChatDeliverySuccess          = "success"
	ChatDeliveryFailure          = "failure"
	ChatDeliveryUnknown          = "unknown"
)

type ChatResult struct {
	Status                      string `json:"status"`
	Message                     string `json:"message"`
	ServerResponse              string `json:"server_response,omitempty"`
	ServerResponseType          string `json:"server_response_type,omitempty"`
	ServerResponseObserved      bool   `json:"server_response_observed"`
	ServerResponseCode          *int   `json:"server_response_code,omitempty"`
	ServerEvent                 int    `json:"server_event,omitempty"`
	DeliveryStatus              string `json:"delivery_status"`
	ServerKeyIncluded           bool   `json:"server_key_included"`
	ConnectionMode              string `json:"connection_mode"`
	GameServerResponseLatencyMS int64  `json:"game_server_response_latency_ms"`
	GameServerStatus            string `json:"game_server_status"`
}

type ProtocolState struct {
	ServerKey                  string `json:"server_key,omitempty"`
	SelectedRoleOpaque         string `json:"selected_role_opaque,omitempty"`
	ServerKeyStored            bool   `json:"server_key_stored"`
	SelectedRoleOpaqueStored   bool   `json:"selected_role_opaque_stored"`
	ServerKeyIncludedInSelect  bool   `json:"server_key_included_in_select"`
	ServerKeyIncludedInChat    bool   `json:"server_key_included_in_private_chat"`
	RoleOpaqueIncludedInSelect bool   `json:"role_opaque_included_in_select"`
}

type Config struct {
	Version                string
	MapID                  string
	RequestTimeout         time.Duration
	ChatResponseTimeout    time.Duration
	MapReadyTimeout        time.Duration
	MaxChatRunes           int
	RequireMapEvents       bool
	AllowResponseOnlyReady bool
	PostEntryInit          bool
	HeartbeatInterval      time.Duration
	HeartbeatOperation     int
	RetentionMode          RetentionMode
	ServerKeyFieldID       int
	ServerAddress          string
	RoleOpaqueResolver     RoleOpaqueResolver
	ReconnectConfig        ReconnectConfig
	ServerID               string
	Account                string
	ExchangeRecorder       ExchangeRecorder
}

type Snapshot struct {
	State                State        `json:"state"`
	CharacterID          string       `json:"character_id,omitempty"`
	MapID                string       `json:"map_id,omitempty"`
	Roles                []RoleOption `json:"roles"`
	ServerKeyStored      bool         `json:"server_key_stored"`
	SelectedOpaqueStored bool         `json:"selected_opaque_stored"`
	SentMessages         int          `json:"sent_messages"`
	ChatSuccessCount     int          `json:"chat_success_count"`
	ChatFailureCount     int          `json:"chat_failure_count"`
	ChatUnknownCount     int          `json:"chat_unknown_count"`
	LastError            string       `json:"last_error,omitempty"`
	CreatedAt            time.Time    `json:"created_at"`
	UpdatedAt            time.Time    `json:"updated_at"`
}

type RemoteError struct {
	Operation int
	Code      int
	Message   string
}

func (e *RemoteError) Error() string {
	if e.Message == "" {
		return fmt.Sprintf("remote operation %d failed with rc=%d", e.Operation, e.Code)
	}
	return fmt.Sprintf("remote operation %d failed with rc=%d: %s", e.Operation, e.Code, e.Message)
}

func (e *RemoteError) Unwrap() error { return ErrRemote }

type TimeoutError struct {
	Operation int
	Stage     string
	Cause     error
}

func (e *TimeoutError) Error() string {
	return fmt.Sprintf("%s timed out for operation %d", e.Stage, e.Operation)
}

func (e *TimeoutError) Unwrap() error { return e.Cause }

func ErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrInvalidState):
		return "invalid_state"
	case errors.Is(err, ErrMissingCredential):
		return "missing_credential"
	case errors.Is(err, ErrMissingCharacter):
		return "missing_character_id"
	case errors.Is(err, ErrRoleSelectionRequired):
		return "role_selection_required"
	case errors.Is(err, ErrMissingRoleOpaque):
		return "missing_role_opaque"
	case errors.Is(err, ErrRoleOpaqueAmbiguous):
		return "role_opaque_ambiguous"
	case errors.Is(err, ErrMapInitializationTimeout):
		return "map_initialization_timeout"
	case errors.Is(err, ErrTimeout):
		return "timeout"
	case errors.Is(err, ErrKickedOut):
		return "kicked_out"
	case errors.Is(err, ErrConnectionLost):
		return "connection_lost"
	case errors.Is(err, ErrRemote):
		return "remote_error"
	case errors.Is(err, ErrProtocol):
		return "protocol_error"
	case errors.Is(err, ErrClosed):
		return "closed"
	default:
		return "transport_error"
	}
}

func normalizeConfig(config Config) Config {
	if config.RequestTimeout <= 0 {
		config.RequestTimeout = 10 * time.Second
	}
	if config.ChatResponseTimeout <= 0 {
		config.ChatResponseTimeout = time.Second
	}
	if config.MapReadyTimeout <= 0 {
		config.MapReadyTimeout = 8 * time.Second
	}
	if config.MaxChatRunes <= 0 {
		config.MaxChatRunes = 512
	}
	if config.RetentionMode == "" {
		config.RetentionMode = RetainSessionData
	}
	config.HeartbeatInterval = FixedHeartbeatInterval
	config.HeartbeatOperation = FixedHeartbeatOperation
	return config
}
