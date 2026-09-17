package gamesession

import (
	"context"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestPrivateHerwarpClassifiesOfflineFailure(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("玩家不在线无法传送。"),
	}}
	session := readyTestSession(t, client)

	result, err := session.SendPrivateChat(context.Background(), "herwarp@315")
	if err != nil {
		t.Fatal(err)
	}
	if result.DeliveryStatus != ChatDeliveryFailure || result.ServerResponse != "玩家不在线无法传送。" {
		t.Fatalf("herwarp offline result was not classified: %+v", result)
	}
}

func TestPrivateHerwarpClassifiesSuccess(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("已将玩家qwe传送到您身边。"),
	}}
	session := readyTestSession(t, client)

	result, err := session.SendPrivateChat(context.Background(), "herwarp@344")
	if err != nil {
		t.Fatal(err)
	}
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponse != "已将玩家qwe传送到您身边。" {
		t.Fatalf("herwarp success was not classified: %+v", result)
	}
}

func TestPrivateBanIgnoresBroadcastUntilSystemSuccess(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		chatEcho(gameprotocol.PrivateChatChannel, "ban@344"),
		banBroadcastEvent(),
		systemEvent("已封禁角色[qwe(344)]。"),
	}}
	session := readyTestSession(t, client)

	result, err := session.SendPrivateChat(context.Background(), "ban@344")
	if err != nil {
		t.Fatal(err)
	}
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponse != "已封禁角色[qwe(344)]。" {
		t.Fatalf("ban success was not classified: %+v", result)
	}
}

func TestBanRequiresMatchingCharacterID(t *testing.T) {
	command, recognized := parsePrivateBanCommand(gameprotocol.PrivateChatChannel, "ban@344")
	if !recognized || !command.valid {
		t.Fatal("ban command was not parsed")
	}
	if status := classifyBanSystemMessage("已封禁角色[qwe(315)]。", command); status != ChatDeliveryUnknown {
		t.Fatalf("mismatched ban result was classified as %s", status)
	}
}

func TestPrivateBanClassifiesOfflineFailure(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("角色[344]不在线,无法封禁(需玩家在线时执行)。"),
	}}
	session := readyTestSession(t, client)

	result, err := session.SendPrivateChat(context.Background(), "ban@344")
	if err != nil {
		t.Fatal(err)
	}
	if result.DeliveryStatus != ChatDeliveryFailure || result.ServerResponse != "角色[344]不在线,无法封禁(需玩家在线时执行)。" {
		t.Fatalf("ban offline result was not classified: %+v", result)
	}
}

func readyTestSession(t *testing.T, client *scriptedClient) *Session {
	t.Helper()
	session, err := New(client, Config{ChatResponseTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady
	return session
}

func banBroadcastEvent() gameprotocol.Message {
	eventID := 1
	return gameprotocol.Message{
		Type:  "evt",
		Event: &eventID,
		Params: []gameprotocol.Param{
			{ID: 21, Value: "system"},
			{ID: 22, Value: ""},
			{ID: 23, Value: "检测出[q**](ID:**4)作弊或篡改数据等违规操作，已进行封禁处理。"},
			{ID: 19, Value: map[string]any{"$i64": "0"}},
		},
	}
}
