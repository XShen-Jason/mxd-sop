package operatorapi

import (
	"embed"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/servercatalog"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

//go:embed assets/*
var assetFS embed.FS

type Handler struct {
	manager               *sessioncontrol.Manager
	catalog               *servercatalog.Catalog
	assets                http.Handler
	store                 *autostore.Store
	accounts              *sessioncontrol.AccountManager
	serviceToken          string
	secureCookie          bool
	legacyUnauthenticated bool
	operatorMu            sync.Mutex
	operatorSessions      map[string]operatorSession
	loginFailures         map[string]loginFailure
	executionMu           sync.Mutex
}

func NewHandler(manager *sessioncontrol.Manager, catalog *servercatalog.Catalog, options ...Options) (http.Handler, error) {
	if manager == nil || catalog == nil {
		return nil, errors.New("manager and catalog are required")
	}
	assets, err := fsHandler()
	if err != nil {
		return nil, err
	}
	handler := &Handler{manager: manager, catalog: catalog, assets: assets}
	if len(options) > 0 {
		handler.configure(options[0])
	} else {
		handler.configure(Options{})
	}
	if handler.store != nil {
		manager.SetExchangeRecorder(gameExchangeAudit{store: handler.store})
	}
	return handler, nil
}

func (h *Handler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if h.store != nil && shouldAudit(request.URL.Path) {
		request = requestWithAuditBody(request)
		wrapped := &auditResponseWriter{ResponseWriter: writer, status: http.StatusOK}
		started := time.Now()
		h.serveHTTP(wrapped, request)
		_ = h.store.Record(AuditEntryForRequest(request, wrapped.status, time.Since(started), wrapped.body.Bytes(), wrapped.truncated))
		return
	}
	h.serveHTTP(writer, request)
}

func (h *Handler) startSession(writer http.ResponseWriter, request *http.Request, serverID string) {
	var input loginRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if input.Account == "" || (input.Password == "" && input.Token == "") {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "missing_credential"})
		return
	}
	snapshot, err := h.manager.Start(request.Context(), serverID, gamesession.Credentials{
		Account: input.Account, Password: input.Password, Token: input.Token,
	})
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, snapshot)
}

func (h *Handler) sessionRoute(writer http.ResponseWriter, request *http.Request, sessionID string, action []string) {
	if len(action) == 0 {
		if request.Method == http.MethodGet {
			snapshot, err := h.manager.Get(sessionID)
			if err != nil {
				writeDomainError(writer, err)
				return
			}
			writeJSON(writer, http.StatusOK, snapshot)
			return
		}
		if request.Method == http.MethodDelete {
			if err := h.manager.Stop(sessionID); err != nil {
				writeDomainError(writer, err)
				return
			}
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		methodNotAllowed(writer, http.MethodGet, http.MethodDelete)
		return
	}
	if len(action) == 2 && action[0] == "diagnostics" {
		if action[1] == "protocol-state" {
			if request.Method != http.MethodGet {
				methodNotAllowed(writer, http.MethodGet)
				return
			}
			h.protocolState(writer, sessionID)
			return
		}
		if action[1] == "chat-without-stored-key" {
			if request.Method != http.MethodPost {
				methodNotAllowed(writer, http.MethodPost)
				return
			}
			h.sessionKeylessChat(writer, request, sessionID)
			return
		}
	}
	if len(action) != 1 || request.Method != http.MethodPost {
		methodNotAllowed(writer, http.MethodPost)
		return
	}
	switch action[0] {
	case "select":
		h.selectCharacter(writer, request, sessionID)
	case "select-and-enter":
		h.selectAndEnter(writer, request, sessionID)
	case "enter":
		snapshot, err := h.manager.Enter(request.Context(), sessionID)
		if err != nil {
			writeDomainError(writer, err)
			return
		}
		writeJSON(writer, http.StatusOK, snapshot)
	case "chat":
		h.chat(writer, request, sessionID)
	default:
		writeJSON(writer, http.StatusNotFound, apiError{Error: "not_found"})
	}
}

func (h *Handler) selectCharacter(writer http.ResponseWriter, request *http.Request, sessionID string) {
	var input selectRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	snapshot, err := h.manager.Select(request.Context(), sessionID, input.CharacterID, input.Opaque)
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, snapshot)
}

func (h *Handler) selectAndEnter(writer http.ResponseWriter, request *http.Request, sessionID string) {
	var input selectRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	snapshot, err := h.manager.SelectAndEnter(request.Context(), sessionID, input.CharacterID, input.Opaque)
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, snapshot)
}

func (h *Handler) chat(writer http.ResponseWriter, request *http.Request, sessionID string) {
	var input chatRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if input.Message == "" {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "missing_message"})
		return
	}
	mode := input.Mode
	if mode == "" {
		mode = gameprotocol.PrivateChatChannel
	}
	if !gameprotocol.IsChatChannel(mode) {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_chat_mode"})
		return
	}
	result, snapshot, err := h.manager.ChatMode(request.Context(), sessionID, mode, input.Message)
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, chatResponse{
		Status:                      result.Status,
		Message:                     result.Message,
		ServerResponse:              result.ServerResponse,
		ServerResponseType:          result.ServerResponseType,
		ServerResponseObserved:      result.ServerResponseObserved,
		ServerResponseCode:          result.ServerResponseCode,
		ServerEvent:                 result.ServerEvent,
		DeliveryStatus:              result.DeliveryStatus,
		ServerKeyIncluded:           result.ServerKeyIncluded,
		ConnectionMode:              result.ConnectionMode,
		GameServerResponseLatencyMS: result.GameServerResponseLatencyMS,
		GameServerStatus:            result.GameServerStatus,
		Session:                     snapshot,
	})
}
