package gamesession

import (
	"context"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestPrivateDropIgnoresHeartbeatEventUntilSuccess(t *testing.T) {
	command := "drop@235@01113084@1"
	client := &scriptedClient{responses: []gameprotocol.Message{
		eventMessage(18),
		systemEvent("已将装备[01113084]1发送到玩家[霸气]的背包。"),
	}}
	session, err := New(client, Config{ChatResponseTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady

	result, err := session.SendPrivateChat(context.Background(), command)
	if err != nil {
		t.Fatal(err)
	}
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponse != "已将装备[01113084]1发送到玩家[霸气]的背包。" {
		t.Fatalf("heartbeat event prevented drop success: %+v", result)
	}
}

func TestHeartbeatSkipsTransportWhileChatIsInFlight(t *testing.T) {
	session, err := New(&scriptedClient{}, Config{})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady
	session.operationInFlight = true

	_, ready, locked := session.lockHeartbeatTransport()
	if !ready || locked {
		t.Fatalf("heartbeat acquired in-flight chat transport: ready=%t locked=%t", ready, locked)
	}
}

func eventMessage(eventID int) gameprotocol.Message {
	return gameprotocol.Message{Type: "evt", Event: &eventID}
}
