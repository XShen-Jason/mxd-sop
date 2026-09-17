package operatorapi

import (
	"net/http"
)

func (h *Handler) protocolState(writer http.ResponseWriter, sessionID string) {
	state, err := h.manager.ProtocolState(sessionID)
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, state)
}

func (h *Handler) sessionKeylessChat(writer http.ResponseWriter, request *http.Request, sessionID string) {
	var input chatRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if input.Message == "" {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "missing_message"})
		return
	}
	result, snapshot, err := h.manager.ChatWithoutKey(request.Context(), sessionID, input.Message)
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

func (h *Handler) serverKeylessChat(writer http.ResponseWriter, request *http.Request, serverID string) {
	var input chatRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if input.Message == "" {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "missing_message"})
		return
	}
	result, err := h.manager.ProbeChatWithoutLogin(request.Context(), serverID, input.Message)
	if err != nil {
		writeDomainError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, keylessProbeResponse{
		Status:                      result.Status,
		Message:                     result.Message,
		DeliveryStatus:              result.DeliveryStatus,
		ServerKeyIncluded:           result.ServerKeyIncluded,
		ConnectionMode:              result.ConnectionMode,
		GameServerResponseLatencyMS: result.GameServerResponseLatencyMS,
		GameServerStatus:            result.GameServerStatus,
	})
}

type keylessProbeResponse struct {
	Status                      string `json:"status"`
	Message                     string `json:"message"`
	DeliveryStatus              string `json:"delivery_status"`
	ServerKeyIncluded           bool   `json:"server_key_included"`
	ConnectionMode              string `json:"connection_mode"`
	GameServerResponseLatencyMS int64  `json:"game_server_response_latency_ms"`
	GameServerStatus            string `json:"game_server_status"`
}
