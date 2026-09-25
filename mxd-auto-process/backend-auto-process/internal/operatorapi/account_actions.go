package operatorapi

import (
	"net/http"
	"strings"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

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
