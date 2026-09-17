package operatorapi

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

type overviewServer struct {
	ID           string                           `json:"id"`
	Name         string                           `json:"name"`
	Address      string                           `json:"address"`
	Version      string                           `json:"version"`
	MapID        string                           `json:"map_id"`
	Enabled      bool                             `json:"enabled"`
	KeylessProbe bool                             `json:"keyless_probe_enabled"`
	Accounts     []sessioncontrol.AccountSnapshot `json:"accounts"`
}

type overviewResponse struct {
	FetchedAt string                    `json:"fetched_at"`
	Servers   []overviewServer          `json:"servers"`
	Sessions  []sessioncontrol.Snapshot `json:"sessions"`
	Logs      any                       `json:"logs"`
}

func (h *Handler) overview(writer http.ResponseWriter, request *http.Request) {
	value, err := h.buildOverview(request.URL.Query().Get("include_logs") != "false")
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "overview_unavailable"})
		return
	}
	writeJSON(writer, http.StatusOK, value)
}

func (h *Handler) logs(writer http.ResponseWriter, request *http.Request) {
	limit, _ := strconv.Atoi(request.URL.Query().Get("limit"))
	serverID := request.URL.Query().Get("server_id")
	if serverID == "" {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "missing_server_id"})
		return
	}
	if _, ok := h.catalog.Get(serverID); !ok {
		writeJSON(writer, http.StatusNotFound, apiError{Error: "server_not_found"})
		return
	}
	accountID := request.URL.Query().Get("account_id")
	accountName := ""
	if accountID != "" && h.accounts != nil {
		if account, found, accountErr := h.account(serverID, accountID); accountErr != nil {
			writeJSON(writer, http.StatusInternalServerError, apiError{Error: "logs_unavailable"})
			return
		} else if !found {
			writeJSON(writer, http.StatusNotFound, apiError{Error: "account_not_found"})
			return
		} else {
			accountName = account.Username
		}
	}
	if h.store == nil {
		writeJSON(writer, http.StatusOK, map[string]any{"logs": []any{}})
		return
	}
	entries, err := h.store.LogsForAccount(limit, serverID, accountID, accountName)
	if err != nil {
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "logs_unavailable"})
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"logs": entries})
}

func (h *Handler) events(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Content-Type", "text/event-stream")
	writer.Header().Set("Cache-Control", "no-cache")
	writer.Header().Set("Connection", "keep-alive")
	flusher, ok := writer.(http.Flusher)
	if !ok {
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "stream_unavailable"})
		return
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		value, err := h.buildOverview(false)
		if err != nil {
			return
		}
		data, err := json.Marshal(value)
		if err != nil {
			return
		}
		_, _ = writer.Write([]byte("event: snapshot\ndata: " + string(data) + "\n\n"))
		flusher.Flush()
		select {
		case <-request.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func (h *Handler) buildOverview(includeLogs bool) (overviewResponse, error) {
	entries := h.catalog.List()
	servers := make([]overviewServer, 0, len(entries))
	for _, entry := range entries {
		accounts := []sessioncontrol.AccountSnapshot{}
		if h.accounts != nil {
			var err error
			accounts, err = h.accounts.List(entry.ID)
			if err != nil {
				return overviewResponse{}, err
			}
		}
		servers = append(servers, overviewServer{ID: entry.ID, Name: entry.Name, Address: entry.Address, Version: entry.Version, MapID: entry.MapID, Enabled: entry.Enabled, KeylessProbe: entry.AllowKeylessProbe, Accounts: accounts})
	}
	logs := any([]any{})
	if includeLogs && h.store != nil {
		entries, err := h.store.Logs(100)
		if err != nil {
			return overviewResponse{}, err
		}
		logs = entries
	}
	return overviewResponse{FetchedAt: time.Now().UTC().Format(time.RFC3339Nano), Servers: servers, Sessions: h.manager.List(), Logs: logs}, nil
}
