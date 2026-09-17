package gamesession

import (
	"context"
	"errors"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

const (
	messageMonitorRetryDelay = 100 * time.Millisecond
)

// StartMessageMonitor watches unsolicited messages without competing with a
// business operation for framed TCP reads.
func (s *Session) StartMessageMonitor(ctx context.Context) {
	s.mu.Lock()
	if s.monitorStarted {
		s.mu.Unlock()
		return
	}
	s.monitorStarted = true
	s.mu.Unlock()

	go func() {
		for {
			if s.monitorStopped(ctx) {
				return
			}
			transport, receiveCtx, cancel, locked := s.lockMonitorTransport(ctx)
			if !locked {
				if !s.waitForMonitorRetry(ctx) {
					return
				}
				continue
			}

			message, err := transport.Receive(receiveCtx)
			cancel()
			s.transportMu.Unlock()
			s.clearMonitorReadCancel()
			if err != nil {
				if s.monitorStopped(ctx) {
					return
				}
				if !errors.Is(err, context.Canceled) {
					s.requestRecovery(connectionLostError(err))
				}
				continue
			}
			if s.handleMonitorMessage(ctx, message) {
				continue
			}
			return
		}
	}()
}

func (s *Session) lockMonitorTransport(ctx context.Context) (gameprotocol.Client, context.Context, context.CancelFunc, bool) {
	s.mu.Lock()
	if s.state != StateReady || s.operationInFlight {
		s.mu.Unlock()
		return nil, nil, nil, false
	}
	s.transportMu.Lock()
	transport := s.transport
	receiveCtx, cancel := context.WithCancel(ctx)
	s.setMonitorReadCancel(cancel)
	s.mu.Unlock()
	return transport, receiveCtx, cancel, true
}

func (s *Session) monitorStopped(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return true
	case <-s.monitorStop:
		return true
	default:
		return false
	}
}

func (s *Session) setMonitorReadCancel(cancel context.CancelFunc) {
	s.monitorMu.Lock()
	s.monitorReadCancel = cancel
	s.monitorMu.Unlock()
}

func (s *Session) clearMonitorReadCancel() {
	s.monitorMu.Lock()
	s.monitorReadCancel = nil
	s.monitorMu.Unlock()
}

func (s *Session) cancelMonitorRead() {
	s.monitorMu.Lock()
	cancel := s.monitorReadCancel
	s.monitorMu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (s *Session) waitForMonitorRetry(ctx context.Context) bool {
	timer := time.NewTimer(messageMonitorRetryDelay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-s.monitorStop:
		return false
	case <-timer.C:
		return true
	}
}

func (s *Session) handleMonitorMessage(ctx context.Context, message gameprotocol.Message) bool {
	if !message.IsEvent(20) || !isSystemEvent(message) {
		return true
	}
	text, _ := message.StringParam(36)
	if !isKickedOutMessage(text) {
		return true
	}

	if ctx.Err() != nil {
		return false
	}
	s.mu.Lock()
	recovered := s.requestReconnectLocked(ErrKickedOut)
	s.mu.Unlock()
	return recovered
}
