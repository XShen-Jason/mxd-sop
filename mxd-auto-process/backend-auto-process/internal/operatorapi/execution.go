package operatorapi

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gameprotocol"
	"github.com/local/mxd-auto-process/internal/gamesession"
	"github.com/local/mxd-auto-process/internal/sessioncontrol"
)

type executeRequest struct {
	ExecutionID string                       `json:"execution_id"`
	Commands    []autostore.ExecutionCommand `json:"commands"`
	Retry       bool                         `json:"retry"`
}

type executeResponse struct {
	ExecutionID       string                       `json:"execution_id"`
	Status            string                       `json:"status"`
	Attempts          int                          `json:"attempts"`
	SelectedAccountID string                       `json:"selected_account_id,omitempty"`
	FailureReason     string                       `json:"failure_reason,omitempty"`
	Commands          []autostore.ExecutionCommand `json:"commands"`
}

func (h *Handler) execute(writer http.ResponseWriter, request *http.Request, serverID string) {
	var input executeRequest
	if err := decodeJSON(writer, request, &input); err != nil {
		return
	}
	if strings.TrimSpace(input.ExecutionID) == "" || len(input.Commands) == 0 || len(input.Commands) > 10000 {
		writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_execution"})
		return
	}
	commands := make([]autostore.ExecutionCommand, len(input.Commands))
	seen := make(map[string]struct{}, len(input.Commands))
	for index, command := range input.Commands {
		command.ID = strings.TrimSpace(command.ID)
		command.Text = strings.TrimSpace(command.Text)
		if command.ID == "" {
			writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_command_id"})
			return
		}
		if command.Text == "" || len([]rune(command.Text)) > 512 {
			writeJSON(writer, http.StatusBadRequest, apiError{Error: "invalid_execution"})
			return
		}
		if _, exists := seen[command.ID]; exists {
			writeJSON(writer, http.StatusBadRequest, apiError{Error: "duplicate_command"})
			return
		}
		seen[command.ID] = struct{}{}
		command.Status = "pending"
		commands[index] = command
	}
	h.executionMu.Lock()
	defer h.executionMu.Unlock()
	execution, responseStatus, err := h.runExecution(request.Context(), serverID, input.ExecutionID, commands, input.Retry)
	if err != nil {
		if errors.Is(err, autostore.ErrExecutionConflict) {
			writeJSON(writer, http.StatusConflict, apiError{Error: "execution_conflict"})
			return
		}
		writeJSON(writer, http.StatusInternalServerError, apiError{Error: "execution_unavailable"})
		return
	}
	writeJSON(writer, responseStatus, executeResponse{ExecutionID: execution.ID, Status: executionResponseStatus(execution), Attempts: execution.Attempts, SelectedAccountID: execution.SelectedAccountID, FailureReason: executionFailureReason(execution), Commands: execution.Commands})
}

func executionResponseStatus(execution autostore.Execution) string {
	for _, command := range execution.Commands {
		if command.Status == "unknown" {
			return "unknown"
		}
	}
	return execution.Status
}

func executionFailureReason(execution autostore.Execution) string {
	if execution.Status == "failure" && execution.SelectedAccountID == "" {
		return "no_online_accounts"
	}
	return ""
}

func (h *Handler) runExecution(ctx context.Context, serverID, executionID string, commands []autostore.ExecutionCommand, retry bool) (autostore.Execution, int, error) {
	if h.store == nil || h.accounts == nil {
		return autostore.Execution{}, http.StatusServiceUnavailable, errors.New("execution storage unavailable")
	}
	hash := autostore.ExecutionHash(serverID, commands)
	execution, found, err := h.store.Execution(executionID)
	if err != nil {
		return autostore.Execution{}, 0, err
	}
	if found {
		if execution.ServerID != serverID || execution.RequestHash != hash {
			return autostore.Execution{}, 0, autostore.ErrExecutionConflict
		}
		// An unknown result means the frame was written but no matching game
		// response was observed. Never resend it implicitly: the player may
		// already have received the reward.
		if execution.Status == "success" || hasUnknownCommand(execution) || (!retry && execution.Attempts > 0) {
			return execution, http.StatusOK, nil
		}
	} else {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		execution = autostore.Execution{ID: executionID, ServerID: serverID, RequestHash: hash, Commands: commands, Status: "running", CreatedAt: now, UpdatedAt: now}
	}
	execution.Attempts++
	execution.Status = "running"
	accounts, err := h.accounts.List(serverID)
	if err != nil {
		return autostore.Execution{}, 0, err
	}
	ids := make([]string, 0, len(accounts))
	for _, account := range accounts {
		if account.Enabled && account.AutomationEnabled && account.Status == sessioncontrol.AccountOnline {
			ids = append(ids, account.ID)
		}
	}
	accountID, ok, err := h.store.NextRoundRobin(serverID, ids)
	if err != nil {
		return autostore.Execution{}, 0, err
	}
	if !ok {
		execution.Status = "failure"
		execution.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := h.store.SaveExecution(execution); err != nil {
			return autostore.Execution{}, 0, err
		}
		return execution, http.StatusOK, nil
	}
	execution.SelectedAccountID = accountID
	for index := range execution.Commands {
		command := &execution.Commands[index]
		if command.Status == "success" {
			continue
		}
		for {
			command.AccountID = accountID
			// Audit commands are always delivered as individual private chats. The
			// execution batch is transport-only; command texts are never joined.
			result, _, chatErr := h.accounts.ChatIfOnline(ctx, accountID, gameprotocol.PrivateChatChannel, command.Text)
			command.DeliveryStatus = result.DeliveryStatus
			command.Message = result.Message
			if chatErr != nil {
				// A disabled/reconnecting account was rejected before any chat
				// frame was written. It is safe to move this command to the next
				// online account without risking a duplicate delivery.
				if errors.Is(chatErr, sessioncontrol.ErrAccountOffline) || errors.Is(chatErr, sessioncontrol.ErrAccountDisabled) {
					command.AccountID = ""
					ids = removeAccountID(ids, accountID)
					next, nextOK, nextErr := h.store.NextRoundRobin(serverID, ids)
					if nextErr != nil {
						return autostore.Execution{}, 0, nextErr
					}
					if nextOK {
						accountID = next
						execution.SelectedAccountID = accountID
						continue
					}
				}
				command.Status = "failure"
				command.Message = chatErr.Error()
			} else if result.DeliveryStatus == gamesession.ChatDeliverySuccess {
				command.Status = "success"
			} else if result.DeliveryStatus == gamesession.ChatDeliveryUnknown {
				command.Status = "unknown"
				command.Message = "chat frame written; game-server response was not observed; delivery must be verified before retry"
			} else if gamesession.IsPlayerNamePermissionResponse(result.ServerResponse) {
				// A valid game response with this text means the current GM account
				// lacks permission for the command. Remove it from this execution and
				// retry the same command on another online account.
				ids = removeAccountID(ids, accountID)
				next, nextOK, nextErr := h.store.NextRoundRobin(serverID, ids)
				if nextErr != nil {
					return autostore.Execution{}, 0, nextErr
				}
				if nextOK {
					accountID = next
					execution.SelectedAccountID = accountID
					continue
				}
				command.Status = "failure"
			} else {
				command.Status = "failure"
			}
			execution.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			if err := h.store.SaveExecution(execution); err != nil {
				return autostore.Execution{}, 0, err
			}
			break
		}
		if command.Status != "success" {
			break
		}
	}
	execution.Status = "success"
	for _, command := range execution.Commands {
		if command.Status == "unknown" {
			// The SQLite execution status remains failure for compatibility with
			// existing databases; the response projection exposes unknown.
			execution.Status = "failure"
			break
		}
		if command.Status != "success" {
			execution.Status = "failure"
			break
		}
	}
	execution.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := h.store.SaveExecution(execution); err != nil {
		return autostore.Execution{}, 0, err
	}
	return execution, http.StatusOK, nil
}

func hasUnknownCommand(execution autostore.Execution) bool {
	for _, command := range execution.Commands {
		if command.Status == "unknown" {
			return true
		}
	}
	return false
}

func removeAccountID(ids []string, excluded string) []string {
	filtered := make([]string, 0, len(ids)-1)
	for _, id := range ids {
		if id != excluded {
			filtered = append(filtered, id)
		}
	}
	return filtered
}
