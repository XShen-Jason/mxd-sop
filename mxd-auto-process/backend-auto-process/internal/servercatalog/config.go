package servercatalog

import (
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
)

const (
	DefaultVersion                    = "1.0.2"
	defaultChatResponseTimeoutSeconds = 3
)

func (s ServerConfig) SessionConfig() gamesession.Config {
	requireMapEvents := true
	if s.RequireMapEvents != nil {
		requireMapEvents = *s.RequireMapEvents
	}
	postEntryInit := true
	if s.PostEntryInit != nil {
		postEntryInit = *s.PostEntryInit
	}
	retentionMode := gamesession.RetentionMode(s.RetentionMode)
	if retentionMode == "" {
		retentionMode = gamesession.RetainSessionData
	}
	return gamesession.Config{
		Version:                s.Version,
		MapID:                  s.MapID,
		RequestTimeout:         time.Duration(s.RequestTimeoutSeconds) * time.Second,
		ChatResponseTimeout:    time.Duration(s.ChatResponseTimeoutSeconds) * time.Second,
		MapReadyTimeout:        time.Duration(s.MapReadyTimeoutSeconds) * time.Second,
		RequireMapEvents:       requireMapEvents,
		AllowResponseOnlyReady: !requireMapEvents,
		PostEntryInit:          postEntryInit,
		ServerKeyFieldID:       s.ServerKeyFieldID,
		RetentionMode:          retentionMode,
		HeartbeatInterval:      gamesession.FixedHeartbeatInterval,
		HeartbeatOperation:     gamesession.FixedHeartbeatOperation,
	}
}

func validate(entry ServerConfig) error {
	if !validID(entry.ID) {
		return fmt.Errorf("invalid server id %q", entry.ID)
	}
	if strings.TrimSpace(entry.Name) == "" {
		return fmt.Errorf("server %q has no name", entry.ID)
	}
	host, portText, err := net.SplitHostPort(entry.Address)
	if err != nil || strings.TrimSpace(host) == "" {
		return fmt.Errorf("server %q has invalid address %q", entry.ID, entry.Address)
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("server %q has invalid port", entry.ID)
	}
	if strings.TrimSpace(entry.Version) == "" || strings.TrimSpace(entry.MapID) == "" {
		return fmt.Errorf("server %q requires version and map_id", entry.ID)
	}
	if entry.MaxBodyBytes > gameprotocol.MaxAllowedBodySize {
		return fmt.Errorf("server %q max_body_bytes exceeds safety limit", entry.ID)
	}
	if entry.ConnectTimeoutSeconds < 0 || entry.ConnectTimeoutSeconds > 300 ||
		entry.RequestTimeoutSeconds < 0 || entry.RequestTimeoutSeconds > 300 ||
		entry.ChatResponseTimeoutSeconds < 0 || entry.ChatResponseTimeoutSeconds > 300 ||
		entry.MapReadyTimeoutSeconds < 0 || entry.MapReadyTimeoutSeconds > 300 {
		return fmt.Errorf("server %q has an invalid timeout", entry.ID)
	}
	if entry.RetentionMode != "" && entry.RetentionMode != string(gamesession.RetainSessionData) && entry.RetentionMode != string(gamesession.RetainMinimal) {
		return fmt.Errorf("server %q has an invalid retention_mode", entry.ID)
	}
	return nil
}

func withDefaults(entry ServerConfig) ServerConfig {
	if strings.TrimSpace(entry.Version) == "" {
		entry.Version = DefaultVersion
	}
	if entry.MaxBodyBytes == 0 {
		entry.MaxBodyBytes = 4 * 1024 * 1024
	}
	if entry.ConnectTimeoutSeconds <= 0 {
		entry.ConnectTimeoutSeconds = 8
	}
	if entry.RequestTimeoutSeconds <= 0 {
		entry.RequestTimeoutSeconds = 10
	}
	if entry.ChatResponseTimeoutSeconds <= 0 {
		entry.ChatResponseTimeoutSeconds = defaultChatResponseTimeoutSeconds
	}
	if entry.MapReadyTimeoutSeconds <= 0 {
		entry.MapReadyTimeoutSeconds = 8
	}
	entry.Heartbeat = HeartbeatSettings{
		Enabled:         true,
		IntervalSeconds: int(gamesession.FixedHeartbeatInterval / time.Second),
		Operation:       gamesession.FixedHeartbeatOperation,
	}
	return entry
}

func upgradeLegacyDefaults(entry ServerConfig) ServerConfig {
	// One second was the former generated default and is too short for command
	// batches with interleaved asynchronous server events. Existing catalogs are
	// persisted in SQLite, so upgrading only servers.json would not affect them.
	if entry.ChatResponseTimeoutSeconds == 1 {
		entry.ChatResponseTimeoutSeconds = defaultChatResponseTimeoutSeconds
	}
	return entry
}

func validID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for index, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || (index > 0 && character == '-') {
			continue
		}
		return false
	}
	return value[0] != '-'
}
