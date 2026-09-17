package gamesession

import (
	"encoding/json"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

const (
	ExchangeSuccess         = "success"
	ExchangeFailure         = "failure"
	ExchangeUnknown         = "unknown"
	ExchangeUnconfirmed     = "unconfirmed"
	maxExchangeResponses    = 64
	maxExchangePayloadBytes = 64 * 1024
)

type ExchangeRecord struct {
	ServerID  string
	Account   string
	Operation int
	Summary   string
	Request   any
	Responses []any
	Outcome   string
	ErrorCode string
	StartedAt time.Time
	Duration  time.Duration
}

type ExchangeRecorder interface {
	RecordGameExchange(ExchangeRecord) error
}

type exchangeTrace struct {
	operation int
	summary   string
	request   any
	responses []any
	startedAt time.Time
}

func (s *Session) beginExchangeLocked(request gameprotocol.Message) {
	if s.config.ExchangeRecorder == nil || request.Op == nil || *request.Op == FixedHeartbeatOperation {
		return
	}
	operation := *request.Op
	s.activeExchange = &exchangeTrace{
		operation: operation,
		summary:   exchangeSummary(operation),
		request:   safeProtocolMessage(request),
		responses: []any{},
		startedAt: time.Now().UTC(),
	}
}

func (s *Session) observeExchangeLocked(message gameprotocol.Message) {
	if s.activeExchange != nil {
		if len(s.activeExchange.responses) >= maxExchangeResponses {
			return
		}
		s.activeExchange.responses = append(s.activeExchange.responses, safeProtocolMessage(message))
	}
}

func (s *Session) finishExchangeLocked(outcome string, operationErr error) {
	trace := s.activeExchange
	s.activeExchange = nil
	if trace == nil || s.config.ExchangeRecorder == nil {
		return
	}
	if outcome == "" {
		outcome = ExchangeSuccess
		if operationErr != nil {
			outcome = ExchangeFailure
		} else if len(trace.responses) == 0 {
			outcome = ExchangeUnconfirmed
		}
	}
	errorCode := ""
	if operationErr != nil {
		errorCode = ErrorCode(operationErr)
	}
	_ = s.config.ExchangeRecorder.RecordGameExchange(ExchangeRecord{
		ServerID: s.config.ServerID, Account: s.config.Account,
		Operation: trace.operation, Summary: trace.summary,
		Request: trace.request, Responses: trace.responses,
		Outcome: outcome, ErrorCode: errorCode,
		StartedAt: trace.startedAt, Duration: time.Since(trace.startedAt),
	})
}

func exchangeSummary(operation int) string {
	switch operation {
	case 0:
		return "登录游戏服务器"
	case 6:
		return "选择游戏角色"
	case 7:
		return "进入游戏地图"
	case 8:
		return "初始化地图状态"
	case 10:
		return "发送游戏消息"
	default:
		return "发送游戏协议请求"
	}
}

func recordStandaloneExchange(config Config, request gameprotocol.Message, startedAt time.Time, outcome string, operationErr error) {
	if config.ExchangeRecorder == nil || request.Op == nil || *request.Op == FixedHeartbeatOperation {
		return
	}
	errorCode := ""
	if operationErr != nil {
		errorCode = ErrorCode(operationErr)
	}
	_ = config.ExchangeRecorder.RecordGameExchange(ExchangeRecord{
		ServerID: config.ServerID, Account: config.Account,
		Operation: *request.Op, Summary: exchangeSummary(*request.Op),
		Request: safeProtocolMessage(request), Responses: []any{},
		Outcome: outcome, ErrorCode: errorCode,
		StartedAt: startedAt, Duration: time.Since(startedAt),
	})
}

func safeProtocolMessage(message gameprotocol.Message) any {
	data, err := json.Marshal(message)
	if err != nil {
		return map[string]any{"error": "message_unavailable"}
	}
	if len(data) > maxExchangePayloadBytes {
		return map[string]any{"error": "message_truncated", "bytes": len(data)}
	}
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return map[string]any{"error": "message_unavailable"}
	}
	redactProtocolFields(value)
	redactProtocolParams(value, message)
	return value
}

func redactProtocolFields(value any) {
	switch current := value.(type) {
	case map[string]any:
		for key, nested := range current {
			if key == "serverKey" || key == "server_key" || key == "opaque" {
				current[key] = "[redacted]"
				continue
			}
			redactProtocolFields(nested)
		}
	case []any:
		for _, nested := range current {
			redactProtocolFields(nested)
		}
	}
}

func redactProtocolParams(value any, message gameprotocol.Message) {
	if message.Type != "op" || message.Op == nil || (*message.Op != 0 && *message.Op != 6) {
		return
	}
	root, ok := value.(map[string]any)
	if !ok {
		return
	}
	params, ok := root["p"].([]any)
	if !ok {
		return
	}
	sensitiveID := 1
	if *message.Op == 6 {
		sensitiveID = 81
	}
	for _, raw := range params {
		pair, ok := raw.([]any)
		if ok && len(pair) == 2 && pair[0] == float64(sensitiveID) {
			pair[1] = "[redacted]"
		}
	}
}
