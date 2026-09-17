package gamesession

import (
	"context"
	"fmt"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

type transportHandoff struct {
	transport            gameprotocol.Client
	serverKey            string
	roles                []roleCredential
	characterID          string
	selectedOpaque       string
	mapID                string
	selectedOpaqueStored bool
}

func (s *Session) replaceTransport(source *Session) error {
	if source == nil {
		return fmt.Errorf("replacement transport is required")
	}
	handoff, err := source.takeTransport()
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.state == StateClosed {
		s.mu.Unlock()
		_ = handoff.transport.Close()
		return ErrClosed
	}
	s.transportMu.Lock()
	oldTransport := s.transport
	s.transport = handoff.transport
	s.serverKey = handoff.serverKey
	s.roles = handoff.roles
	s.characterID = handoff.characterID
	s.selectedOpaque = handoff.selectedOpaque
	s.mapID = handoff.mapID
	s.selectedOpaqueStored = handoff.selectedOpaqueStored
	s.setStateLocked(StateReady)
	s.lastError = ""
	s.touchLocked()
	s.startHeartbeatLocked()
	startMonitor := s.reconnector != nil && s.reconnector.config.Enabled && !s.monitorStarted
	s.transportMu.Unlock()
	s.mu.Unlock()
	if oldTransport != nil {
		_ = oldTransport.Close()
	}
	if startMonitor {
		go s.StartMessageMonitor(context.Background())
	}
	return nil
}

func (s *Session) takeTransport() (transportHandoff, error) {
	s.mu.Lock()
	if s.transport == nil {
		s.mu.Unlock()
		return transportHandoff{}, fmt.Errorf("replacement transport is unavailable")
	}
	s.heartbeatStopOnce.Do(func() { close(s.heartbeatStop) })
	s.monitorStopOnce.Do(func() { close(s.monitorStop) })
	s.cancelMonitorRead()
	s.transportMu.Lock()
	handoff := transportHandoff{
		transport:            s.transport,
		serverKey:            s.serverKey,
		roles:                append([]roleCredential(nil), s.roles...),
		characterID:          s.characterID,
		selectedOpaque:       s.selectedOpaque,
		mapID:                s.mapID,
		selectedOpaqueStored: s.selectedOpaqueStored,
	}
	s.transport = nil
	s.transportMu.Unlock()
	s.mu.Unlock()
	return handoff, nil
}
