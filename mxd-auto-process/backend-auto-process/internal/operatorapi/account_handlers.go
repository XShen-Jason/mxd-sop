package operatorapi

import (
	"net/http"
	"strings"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

func (h *Handler) handleAccountAPI(writer http.ResponseWriter, request *http.Request, parts []string) bool {
	if len(parts) < 2 || parts[0] != "api" || parts[1] != "servers" {
		return false
	}
	if len(parts) == 2 {
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, http.MethodPost)
			return true
		}
		if !h.requireOperator(writer, request) {
			return true
		}
		h.createServer(writer, request)
		return true
	}
	if len(parts) == 3 {
		if request.Method != http.MethodPatch && request.Method != http.MethodDelete {
			return false
		}
		if !h.requireOperator(writer, request) {
			return true
		}
		if request.Method == http.MethodPatch {
			h.updateServer(writer, request, parts[2])
		} else {
			h.deleteServer(writer, request, parts[2])
		}
		return true
	}
	if len(parts) < 4 || (parts[3] != "accounts" && parts[3] != "executions") {
		return false
	}
	serverID := parts[2]
	if _, ok := h.catalog.Get(serverID); !ok {
		writeJSON(writer, http.StatusNotFound, apiError{Error: "server_not_found"})
		return true
	}
	if len(parts) == 4 && parts[3] == "executions" {
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, http.MethodPost)
			return true
		}
		if !h.requireOperator(writer, request) {
			return true
		}
		h.execute(writer, request, serverID)
		return true
	}
	if len(parts) == 4 {
		if request.Method == http.MethodGet {
			if !h.requireOperator(writer, request) {
				return true
			}
			record, err := h.accountsRecord(serverID)
			if err != nil {
				writeAccountError(writer, err)
				return true
			}
			writeJSON(writer, http.StatusOK, record)
			return true
		}
		if request.Method == http.MethodPost {
			if !h.requireOperator(writer, request) {
				return true
			}
			h.createAccount(writer, request, serverID)
			return true
		}
		methodNotAllowed(writer, http.MethodGet, http.MethodPost)
		return true
	}
	accountID := parts[4]
	if len(parts) == 5 {
		if !h.requireOperator(writer, request) {
			return true
		}
		snapshot, ok, err := h.account(serverID, accountID)
		if err != nil {
			writeAccountError(writer, err)
			return true
		}
		if !ok {
			writeJSON(writer, http.StatusNotFound, apiError{Error: "account_not_found"})
			return true
		}
		switch request.Method {
		case http.MethodGet:
			writeJSON(writer, http.StatusOK, snapshot)
		case http.MethodPatch:
			h.updateAccount(writer, request, serverID, snapshot)
		case http.MethodDelete:
			h.deleteAccount(writer, accountID)
		default:
			methodNotAllowed(writer, http.MethodGet, http.MethodPatch, http.MethodDelete)
		}
		return true
	}
	if len(parts) != 6 || request.Method != http.MethodPost {
		methodNotAllowed(writer, http.MethodPost)
		return true
	}
	if !h.requireOperator(writer, request) {
		return true
	}
	snapshot, ok, err := h.account(serverID, accountID)
	if err != nil {
		writeAccountError(writer, err)
		return true
	}
	if !ok {
		writeJSON(writer, http.StatusNotFound, apiError{Error: "account_not_found"})
		return true
	}
	h.accountAction(writer, request, parts[5], snapshot)
	return true
}

func (h *Handler) account(serverID, accountID string) (sessioncontrol.AccountSnapshot, bool, error) {
	accounts, err := h.accounts.List(serverID)
	if err != nil {
		return sessioncontrol.AccountSnapshot{}, false, err
	}
	for _, account := range accounts {
		if account.ID == accountID {
			return account, true, nil
		}
	}
	return sessioncontrol.AccountSnapshot{}, false, nil
}

func (h *Handler) createAccount(writer http.ResponseWriter, request *http.Request, serverID string) {
	account, password, sessionID, err := applyAccountRequest(request, serverID, "", nil)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	var snapshot sessioncontrol.AccountSnapshot
	if sessionID == "" {
		snapshot, err = h.accounts.Create(account, password)
	} else {
		snapshot, err = h.accounts.CreateWithSession(account, password, sessionID)
	}
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, snapshot)
}

func (h *Handler) updateAccount(writer http.ResponseWriter, request *http.Request, serverID string, current sessioncontrol.AccountSnapshot) {
	account := autostore.Account{ID: current.ID, ServerID: serverID, Username: current.Username, CharacterID: current.CharacterID, CharacterName: current.CharacterName, CredentialType: current.CredentialType, Enabled: current.Enabled}
	updated, password, sessionID, err := applyAccountRequest(request, serverID, current.ID, &account)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	if sessionID != "" {
		writeAccountError(writer, errInvalidOperatorRequest)
		return
	}
	snapshot, err := h.accounts.Update(updated, password)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, snapshot)
}

func (h *Handler) deleteAccount(writer http.ResponseWriter, accountID string) {
	if err := h.accounts.Delete(accountID); err != nil {
		writeAccountError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func (h *Handler) accountAction(writer http.ResponseWriter, request *http.Request, action string, account sessioncontrol.AccountSnapshot) {
	var (
		snapshot sessioncontrol.AccountSnapshot
		err      error
	)
	switch action {
	case "start":
		snapshot, err = h.accounts.StartAsync(account.ID)
	case "stop":
		snapshot, err = h.accounts.Stop(account.ID)
	case "reconnect":
		snapshot, err = h.accounts.Reconnect(request.Context(), account.ID)
	case "message":
		h.accountMessage(writer, request, account)
		return
	default:
		writeJSON(writer, http.StatusNotFound, apiError{Error: "not_found"})
		return
	}
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, snapshot)
}

func (h *Handler) accountMessage(writer http.ResponseWriter, request *http.Request, account sessioncontrol.AccountSnapshot) {
	var input chatRequest
	if err := decodeAndRead(request, &input); err != nil {
		writeAccountError(writer, err)
		return
	}
	input.Message = strings.TrimSpace(input.Message)
	if input.Message == "" {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "missing_message"})
		return
	}
	if len([]rune(input.Message)) > 512 {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "message_too_long"})
		return
	}
	if input.Mode == "" {
		input.Mode = gameprotocol.PrivateChatChannel
	}
	if !gameprotocol.IsChatChannel(input.Mode) {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_chat_mode"})
		return
	}
	result, updated, err := h.accounts.Chat(request.Context(), account.ID, input.Mode, input.Message)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"result":  result,
		"account": updated,
	})
}

func applyAccountRequest(request *http.Request, serverID, accountID string, existing *autostore.Account) (autostore.Account, string, string, error) {
	var input accountRequest
	if err := decodeAndRead(request, &input); err != nil {
		return autostore.Account{}, "", "", err
	}
	var account autostore.Account
	if existing != nil {
		account = *existing
	} else {
		account = autostore.Account{ID: generatedID("account"), ServerID: serverID, Enabled: true}
	}
	if accountID != "" {
		account.ID = accountID
	}
	account.ServerID = serverID
	if input.Username != nil {
		account.Username = strings.TrimSpace(*input.Username)
	}
	if input.CharacterID != nil {
		account.CharacterID = strings.TrimSpace(*input.CharacterID)
	}
	if input.CharacterName != nil {
		account.CharacterName = strings.TrimSpace(*input.CharacterName)
	}
	if input.CredentialType != nil {
		account.CredentialType = strings.TrimSpace(*input.CredentialType)
	}
	if input.Enabled != nil {
		account.Enabled = *input.Enabled
	}
	password := ""
	if input.Password != nil {
		password = *input.Password
	}
	if existing == nil && password == "" {
		return autostore.Account{}, "", "", autostore.ErrInvalidPassword
	}
	return account, password, normalizeOptionalText(input.SessionID), nil
}
