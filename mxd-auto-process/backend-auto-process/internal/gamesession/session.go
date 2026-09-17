package gamesession

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

type Session struct {
	mu                   sync.Mutex
	transportMu          sync.Mutex
	transport            gameprotocol.Client
	config               Config
	state                State
	operationInFlight    bool
	serverKey            string
	roles                []roleCredential
	characterID          string
	selectedOpaque       string
	mapID                string
	selectedOpaqueStored bool
	sentMessages         int
	chatSuccessCount     int
	chatFailureCount     int
	chatUnknownCount     int
	lastError            string
	createdAt            time.Time
	updatedAt            time.Time
	heartbeatStop        chan struct{}
	heartbeatStopOnce    sync.Once
	heartbeatStarted     bool
	monitorStop          chan struct{}
	monitorStopOnce      sync.Once
	monitorMu            sync.Mutex
	monitorReadCancel    context.CancelFunc
	monitorStarted       bool
	stateChanged         chan struct{}
	reconnector          *Reconnector
	activeExchange       *exchangeTrace
}

func New(transport gameprotocol.Client, config Config) (*Session, error) {
	if transport == nil {
		return nil, fmt.Errorf("transport is required")
	}
	now := time.Now().UTC()
	return &Session{
		transport:     transport,
		config:        normalizeConfig(config),
		state:         StateNew,
		createdAt:     now,
		updatedAt:     now,
		heartbeatStop: make(chan struct{}),
		monitorStop:   make(chan struct{}),
		stateChanged:  make(chan struct{}),
	}, nil
}

func (s *Session) Login(ctx context.Context, credentials Credentials) (result LoginResult, operationErr error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state != StateNew {
		return LoginResult{}, s.invalidState("login")
	}
	token := credentials.protocolToken()
	if credentials.Account == "" || token == "" {
		return LoginResult{}, s.failLocked(ErrMissingCredential)
	}
	s.setStateLocked(StateAuthenticating)
	s.touchLocked()
	releaseTransport := s.beginTransportOperationLocked()
	defer releaseTransport()

	operationCtx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
	defer cancel()
	request := gameprotocol.Login(credentials.Account, token, s.config.Version)
	s.beginExchangeLocked(request)
	defer func() { s.finishExchangeLocked("", operationErr) }()
	if err := s.transport.Send(operationCtx, request); err != nil {
		return LoginResult{}, s.failLocked(err)
	}
	response, err := s.waitResponse(operationCtx, 0)
	if err != nil {
		return LoginResult{}, s.failLocked(err)
	}
	if err := ensureSuccess(response, 0); err != nil {
		return LoginResult{}, s.failLocked(err)
	}

	if s.config.RetentionMode == RetainSessionData {
		s.serverKey = extractServerKey(response, s.config.ServerKeyFieldID)
		s.roles = extractRoleCredentials(response)
	}
	s.setStateLocked(StateLoggedIn)
	s.lastError = ""
	s.touchLocked()
	s.saveReconnectInfoLocked(credentials, "", "", "")
	return LoginResult{Roles: roleOptions(s.roles), ServerKeyStored: s.serverKey != ""}, nil
}

func (s *Session) EnterGame(ctx context.Context) (operationErr error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state != StateCharacterReady {
		return s.invalidState("enter game")
	}
	mapID := s.mapID
	if mapID == "" {
		mapID = s.config.MapID
	}
	if mapID == "" {
		return s.failLocked(ErrProtocol)
	}
	s.setStateLocked(StateEntering)
	s.touchLocked()
	releaseTransport := s.beginTransportOperationLocked()
	defer releaseTransport()
	if err := s.receiveMapEntry(ctx, mapID); err != nil {
		return s.failLocked(err)
	}
	if s.config.PostEntryInit {
		operationCtx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
		defer cancel()
		request := gameprotocol.PostEntryInit()
		s.beginExchangeLocked(request)
		defer func() { s.finishExchangeLocked("", operationErr) }()
		if err := s.transport.Send(operationCtx, request); err != nil {
			return s.failLocked(err)
		}
		response, err := s.waitResponse(operationCtx, 8)
		if err != nil {
			return s.failLocked(err)
		}
		if err := ensureSuccess(response, 8); err != nil {
			return s.failLocked(err)
		}
	}
	s.mapID = mapID
	s.setStateLocked(StateReady)
	s.lastError = ""
	s.touchLocked()
	s.saveReconnectInfoLocked(Credentials{}, "", "", mapID)
	s.startHeartbeatLocked()

	// 启动消息监听，检测被顶号
	if s.reconnector != nil && s.reconnector.config.Enabled {
		go s.StartMessageMonitor(context.Background())
	}

	return nil
}

func (s *Session) receiveMapEntry(ctx context.Context, mapID string) (operationErr error) {
	responseCtx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
	defer cancel()
	request := gameprotocol.EnterMap(mapID)
	s.beginExchangeLocked(request)
	defer func() { s.finishExchangeLocked("", operationErr) }()
	if err := s.transport.Send(responseCtx, request); err != nil {
		return err
	}
	ready := mapReadyTracker{mapID: mapID}
	responseReceived := false
	for !responseReceived {
		message, err := s.receive(responseCtx, 7, "enter map")
		if err != nil {
			return err
		}
		ready.observe(message)
		if message.IsResponse(7) {
			if err := ensureSuccess(message, 7); err != nil {
				return err
			}
			responseReceived = true
		}
	}
	if !s.config.RequireMapEvents || s.config.AllowResponseOnlyReady || ready.complete() {
		return nil
	}
	readyCtx, readyCancel := context.WithTimeout(ctx, s.config.MapReadyTimeout)
	defer readyCancel()
	for !ready.complete() {
		message, err := s.receive(readyCtx, 7, "map initialization")
		if err != nil {
			if errors.Is(err, ErrTimeout) {
				return &TimeoutError{Operation: 7, Stage: "map initialization", Cause: ErrMapInitializationTimeout}
			}
			return err
		}
		ready.observe(message)
	}
	return nil
}

func (s *Session) waitResponse(ctx context.Context, operation int) (gameprotocol.Message, error) {
	for {
		message, err := s.receive(ctx, operation, "response")
		if err != nil {
			return gameprotocol.Message{}, err
		}
		if message.IsResponse(operation) {
			return message, nil
		}
	}
}

func (s *Session) receive(ctx context.Context, operation int, stage string) (gameprotocol.Message, error) {
	message, err := s.transport.Receive(ctx)
	if err == nil {
		s.observeExchangeLocked(message)
		return message, nil
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return gameprotocol.Message{}, &TimeoutError{Operation: operation, Stage: stage, Cause: ErrTimeout}
	}
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return gameprotocol.Message{}, err
	}
	return gameprotocol.Message{}, connectionLostError(err)
}

func (s *Session) beginTransportOperationLocked() func() {
	s.operationInFlight = true
	s.cancelMonitorRead()
	s.transportMu.Lock()
	return func() {
		s.transportMu.Unlock()
		s.operationInFlight = false
	}
}

func ensureSuccess(message gameprotocol.Message, operation int) error {
	code, ok := message.ResponseCode()
	if !ok {
		return fmt.Errorf("%w: response %d has no rc", ErrProtocol, operation)
	}
	if code == 0 {
		return nil
	}
	messageText, _ := message.StringParam(36)
	return &RemoteError{Operation: operation, Code: code, Message: messageText}
}

func (s *Session) invalidState(operation string) error {
	return fmt.Errorf("%w: cannot %s while state is %s", ErrInvalidState, operation, s.state)
}

func (s *Session) failLocked(err error) error {
	s.setStateLocked(StateFailed)
	s.lastError = ErrorCode(err)
	s.touchLocked()
	return err
}

func (s *Session) setStateLocked(state State) {
	if s.state == state {
		return
	}
	s.state = state
	if s.stateChanged == nil {
		return
	}
	close(s.stateChanged)
	s.stateChanged = make(chan struct{})
}

func (s *Session) touchLocked() { s.updatedAt = time.Now().UTC() }

type mapReadyTracker struct {
	mapID      string
	playerList bool
	mapMarker  bool
}

func (t *mapReadyTracker) observe(message gameprotocol.Message) {
	if message.IsEvent(2) {
		t.playerList = true
	}
	if message.IsEvent(64) && eventContainsParams(message.Params, t.mapID) {
		t.mapMarker = true
	}
}

func (t *mapReadyTracker) complete() bool { return t.playerList && t.mapMarker }
func eventContainsParams(params []gameprotocol.Param, expected string) bool {
	for _, param := range params {
		if eventContains(param.Value, expected) {
			return true
		}
	}
	return false
}
