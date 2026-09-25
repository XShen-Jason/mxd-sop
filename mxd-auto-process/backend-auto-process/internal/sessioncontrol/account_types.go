package sessioncontrol

import "errors"

type AccountStatus string

const (
	AccountDisabled     AccountStatus = "disabled"
	AccountOffline      AccountStatus = "offline"
	AccountConnecting   AccountStatus = "connecting"
	AccountOnline       AccountStatus = "online"
	AccountReconnecting AccountStatus = "reconnecting"
	AccountFailed       AccountStatus = "failed"
)

var (
	ErrAccountOffline        = errors.New("account is offline")
	ErrAccountDisabled       = errors.New("account is disabled")
	ErrSessionServerMismatch = errors.New("session belongs to another server")
)

type AccountSnapshot struct {
	ID                string        `json:"id"`
	ServerID          string        `json:"server_id"`
	Username          string        `json:"username"`
	CharacterID       string        `json:"character_id"`
	CharacterName     string        `json:"character_name,omitempty"`
	CredentialType    string        `json:"credential_type"`
	Enabled           bool          `json:"enabled"`
	AutomationEnabled bool          `json:"automation_enabled"`
	Status            AccountStatus `json:"status"`
	SessionID         string        `json:"session_id,omitempty"`
	Session           *Snapshot     `json:"session,omitempty"`
	LastError         string        `json:"last_error,omitempty"`
	UpdatedAt         string        `json:"updated_at"`
}

type accountRuntime struct {
	status    AccountStatus
	lastError string
	updatedAt string
}
