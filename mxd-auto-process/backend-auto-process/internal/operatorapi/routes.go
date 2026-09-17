package operatorapi

import (
	"net/http"
	"strings"
)

func (h *Handler) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	if strings.HasPrefix(request.URL.Path, "/api/") {
		h.serveAPI(writer, request)
		return
	}
	if request.URL.Path == "/" || request.URL.Path == "/operator" || strings.HasPrefix(request.URL.Path, "/assets/") {
		assetRequest := request.Clone(request.Context())
		if assetRequest.URL.Path == "/operator" {
			assetRequest.URL.Path = "/"
		}
		h.assets.ServeHTTP(writer, assetRequest)
		return
	}
	writeJSON(writer, http.StatusNotFound, apiError{Error: "not_found"})
}

func (h *Handler) serveAPI(writer http.ResponseWriter, request *http.Request) {
	parts := pathParts(request.URL.Path)
	if len(parts) < 2 || parts[0] != "api" || parts[1] != "v1" {
		writeJSON(writer, http.StatusNotFound, apiError{Error: "not_found"})
		return
	}
	parts = append([]string{"api"}, parts[2:]...)
	if h.handleOperatorAPI(writer, request, parts) {
		return
	}
	if h.handleReadOnlyAPI(writer, request, parts) {
		return
	}
	if h.accounts != nil && h.handleAccountAPI(writer, request, parts) {
		return
	}
	if h.handleServerSessionAPI(writer, request, parts) {
		return
	}
	if h.handleSessionAPI(writer, request, parts) {
		return
	}
	writeJSON(writer, http.StatusNotFound, apiError{Error: "not_found"})
}

func (h *Handler) handleServerSessionAPI(writer http.ResponseWriter, request *http.Request, parts []string) bool {
	if len(parts) == 4 && parts[0] == "api" && parts[1] == "servers" && parts[3] == "sessions" {
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, http.MethodPost)
			return true
		}
		if !h.requireOperator(writer, request) {
			return true
		}
		h.startSession(writer, request, parts[2])
		return true
	}
	if len(parts) == 5 && parts[0] == "api" && parts[1] == "servers" && parts[3] == "diagnostics" && parts[4] == "chat-without-login" {
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, http.MethodPost)
			return true
		}
		if !h.requireOperator(writer, request) {
			return true
		}
		h.serverKeylessChat(writer, request, parts[2])
		return true
	}
	return false
}

func (h *Handler) handleOperatorAPI(writer http.ResponseWriter, request *http.Request, parts []string) bool {
	if len(parts) != 3 || parts[0] != "api" || parts[1] != "operator" {
		return false
	}
	switch parts[2] {
	case "login":
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, http.MethodPost)
			return true
		}
		if h.store == nil {
			writeJSON(writer, http.StatusNotFound, apiError{Error: "not_found"})
			return true
		}
		h.operatorLogin(writer, request)
	case "me":
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, http.MethodGet)
			return true
		}
		h.operatorMe(writer, request)
	case "logout":
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, http.MethodPost)
			return true
		}
		h.operatorLogout(writer, request)
	case "password":
		if request.Method != http.MethodPost {
			methodNotAllowed(writer, http.MethodPost)
			return true
		}
		h.operatorChangePassword(writer, request)
	default:
		writeJSON(writer, http.StatusNotFound, apiError{Error: "not_found"})
	}
	return true
}

func (h *Handler) handleReadOnlyAPI(writer http.ResponseWriter, request *http.Request, parts []string) bool {
	if len(parts) != 2 || parts[0] != "api" {
		return false
	}
	switch parts[1] {
	case "overview":
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, http.MethodGet)
			return true
		}
		if h.requireOperator(writer, request) {
			h.overview(writer, request)
		}
	case "logs":
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, http.MethodGet)
			return true
		}
		if h.requireOperator(writer, request) {
			h.logs(writer, request)
		}
	case "events":
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, http.MethodGet)
			return true
		}
		if h.requireOperator(writer, request) {
			h.events(writer, request)
		}
	case "healthz":
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, http.MethodGet)
			return true
		}
		writeJSON(writer, http.StatusOK, map[string]string{"status": "ok"})
	case "servers":
		if request.Method != http.MethodGet {
			return false
		}
		if h.requireOperator(writer, request) {
			writeJSON(writer, http.StatusOK, map[string]any{"servers": h.catalog.PublicList()})
		}
	default:
		return false
	}
	return true
}

func (h *Handler) handleSessionAPI(writer http.ResponseWriter, request *http.Request, parts []string) bool {
	if len(parts) < 2 || parts[0] != "api" || parts[1] != "sessions" {
		return false
	}
	if !h.requireOperator(writer, request) {
		return true
	}
	if len(parts) == 2 {
		if request.Method != http.MethodGet {
			methodNotAllowed(writer, http.MethodGet)
			return true
		}
		writeJSON(writer, http.StatusOK, map[string]any{"sessions": h.manager.List()})
		return true
	}
	h.sessionRoute(writer, request, parts[2], parts[3:])
	return true
}
