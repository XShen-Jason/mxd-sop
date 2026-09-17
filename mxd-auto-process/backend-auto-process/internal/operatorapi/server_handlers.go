package operatorapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/local/mxd-auto-process/internal/servercatalog"
)

func (h *Handler) createServer(writer http.ResponseWriter, request *http.Request) {
	entry, err := serverConfigFromRequest(request, nil)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	if _, exists := h.catalog.Get(entry.ID); exists {
		writeJSON(writer, http.StatusConflict, apiError{Error: "server_exists"})
		return
	}
	if err := h.catalog.Upsert(entry); err != nil {
		writeAccountError(writer, err)
		return
	}
	record, err := h.serverRecord(entry.ID)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	writeJSON(writer, http.StatusCreated, record)
}

func (h *Handler) updateServer(writer http.ResponseWriter, request *http.Request, serverID string) {
	entry, ok := h.catalog.Get(serverID)
	if !ok {
		writeJSON(writer, http.StatusNotFound, apiError{Error: "server_not_found"})
		return
	}
	updated, err := serverConfigFromRequest(request, &entry)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	if serverNeedsRestart(entry, updated) && h.accounts != nil {
		if err := h.accounts.StopServer(serverID); err != nil {
			writeAccountError(writer, err)
			return
		}
	}
	if err := h.catalog.Upsert(updated); err != nil {
		writeAccountError(writer, err)
		return
	}
	record, err := h.serverRecord(serverID)
	if err != nil {
		writeAccountError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, record)
}

func (h *Handler) deleteServer(writer http.ResponseWriter, _ *http.Request, serverID string) {
	if _, ok := h.catalog.Get(serverID); !ok {
		writeJSON(writer, http.StatusNotFound, apiError{Error: "server_not_found"})
		return
	}
	if h.accounts != nil {
		if err := h.accounts.StopServer(serverID); err != nil {
			writeAccountError(writer, err)
			return
		}
	}
	if err := h.catalog.Remove(serverID); err != nil {
		writeAccountError(writer, err)
		return
	}
	writer.WriteHeader(http.StatusNoContent)
}

func serverNeedsRestart(before, after servercatalog.ServerConfig) bool {
	return before.Address != after.Address || before.Enabled != after.Enabled || before.Version != after.Version || before.MapID != after.MapID
}

func (h *Handler) serverRecord(serverID string) (overviewServer, error) {
	entry, ok := h.catalog.Get(serverID)
	if !ok {
		return overviewServer{}, errors.New("server not found")
	}
	accounts, err := h.accounts.List(serverID)
	if err != nil {
		return overviewServer{}, err
	}
	return overviewServer{ID: entry.ID, Name: entry.Name, Address: entry.Address, Version: entry.Version, MapID: entry.MapID, Enabled: entry.Enabled, KeylessProbe: entry.AllowKeylessProbe, Accounts: accounts}, nil
}

func serverConfigFromRequest(request *http.Request, existing *servercatalog.ServerConfig) (servercatalog.ServerConfig, error) {
	var input serverRequest
	if err := decodeAndRead(request, &input); err != nil {
		return servercatalog.ServerConfig{}, err
	}
	if existing == nil {
		entry := servercatalog.ServerConfig{ID: input.ID, Enabled: true}
		if entry.ID == "" {
			entry.ID = generatedID("server")
		}
		entry.Name = normalizeOptionalText(input.Name)
		entry.Address = normalizeOptionalText(input.Address)
		entry.Version = normalizeOptionalText(input.Version)
		entry.MapID = normalizeOptionalText(input.MapID)
		if input.Enabled != nil {
			entry.Enabled = *input.Enabled
		}
		return entry, nil
	}
	entry := *existing
	if input.ID != "" && input.ID != entry.ID {
		return servercatalog.ServerConfig{}, errInvalidOperatorRequest
	}
	if input.Name != nil {
		entry.Name = strings.TrimSpace(*input.Name)
	}
	if input.Address != nil {
		entry.Address = strings.TrimSpace(*input.Address)
	}
	if input.Version != nil {
		entry.Version = strings.TrimSpace(*input.Version)
	}
	if input.MapID != nil {
		entry.MapID = strings.TrimSpace(*input.MapID)
	}
	if input.Enabled != nil {
		entry.Enabled = *input.Enabled
	}
	return entry, nil
}
