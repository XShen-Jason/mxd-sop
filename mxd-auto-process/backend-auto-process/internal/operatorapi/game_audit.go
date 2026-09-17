package operatorapi

import (
	"net/http"
	"time"

	"github.com/local/mxd-auto-process/internal/autostore"
	"github.com/local/mxd-auto-process/internal/gamesession"
)

type gameExchangeAudit struct {
	store *autostore.Store
}

func (a gameExchangeAudit) RecordGameExchange(exchange gamesession.ExchangeRecord) error {
	if a.store == nil {
		return nil
	}
	status := http.StatusOK
	switch exchange.Outcome {
	case gamesession.ExchangeFailure:
		status = http.StatusBadGateway
	case gamesession.ExchangeUnknown, gamesession.ExchangeUnconfirmed:
		status = http.StatusAccepted
	}
	if exchange.ErrorCode == "timeout" || exchange.ErrorCode == "map_initialization_timeout" {
		status = http.StatusGatewayTimeout
	}
	detail := map[string]any{
		"source": "game-server", "server_id": exchange.ServerID,
		"account": exchange.Account, "operation": exchange.Operation,
		"outcome": exchange.Outcome, "request": exchange.Request,
		"responses": exchange.Responses,
	}
	if exchange.ErrorCode != "" {
		detail["error_code"] = exchange.ErrorCode
	}
	createdAt := exchange.StartedAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}
	return a.store.Record(autostore.AuditEntry{
		ID: auditID(), CreatedAt: createdAt.Format(time.RFC3339Nano),
		RequestID: auditID(), Method: "TCP", Path: "/game/servers/" + exchange.ServerID,
		Actor: exchange.Account, Action: exchange.Summary, Status: status,
		DurationMS: exchange.Duration.Milliseconds(), Detail: detail,
	})
}

var _ gamesession.ExchangeRecorder = gameExchangeAudit{}
