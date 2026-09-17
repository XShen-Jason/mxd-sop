package gamesession

import (
	"context"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestPrivateChatReturnsSystemEventText(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{systemEvent("permission denied")}}
	session, err := New(client, Config{ChatResponseTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady

	result, err := session.SendPrivateChat(context.Background(), "hello")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != ChatStatusServerResponse || !result.ServerResponseObserved {
		t.Fatalf("unexpected response status: %+v", result)
	}
	if result.ServerResponse != "permission denied" || result.ServerResponseType != "system_event" || result.ServerEvent != 20 {
		t.Fatalf("server event was not returned: %+v", result)
	}
	if result.DeliveryStatus != ChatDeliveryUnknown || result.GameServerStatus != ChatDeliveryUnknown || result.GameServerResponseLatencyMS < 0 || session.Snapshot().ChatUnknownCount != 1 {
		t.Fatalf("unclassified system event was not counted as unknown: %+v", result)
	}
}

func TestPrivateDropIgnoresEchoUntilSuccess(t *testing.T) {
	command := "drop@265@100000069@1"
	client := &scriptedClient{responses: []gameprotocol.Message{
		chatEcho(gameprotocol.PrivateChatChannel, command),
		systemEvent("已将物品[100000069]×1发送到玩家[REF]的背包。"),
		systemEvent("GM赠送您物品[100000069]×1。"),
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
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponseType != "system_event" || result.ServerResponse == command {
		t.Fatalf("drop echo was treated as the terminal result: %+v", result)
	}
	if snapshot := session.Snapshot(); snapshot.ChatSuccessCount != 1 || snapshot.ChatFailureCount != 0 || snapshot.ChatUnknownCount != 0 {
		t.Fatalf("unexpected drop success counters: %+v", snapshot)
	}
}

func TestPrivateDropClassifiesEquipmentSuccess(t *testing.T) {
	command := "drop@3785@01115371_1@1"
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("已将装备[01115371_1]1发送到玩家[霸气]的背包。"),
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
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponse != "已将装备[01115371_1]1发送到玩家[霸气]的背包。" {
		t.Fatalf("equipment drop was not classified as success: %+v", result)
	}
	if snapshot := session.Snapshot(); snapshot.ChatSuccessCount != 1 || snapshot.ChatFailureCount != 0 || snapshot.ChatUnknownCount != 0 {
		t.Fatalf("unexpected equipment drop counters: %+v", snapshot)
	}
}

func TestPrivateDropClassifiesUnknownCategorySuccess(t *testing.T) {
	command := "drop@3785@01142075@1"
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("已将称号[01142075]1发送到玩家[霸气]的背包。"),
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
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponse != "已将称号[01142075]1发送到玩家[霸气]的背包。" {
		t.Fatalf("unknown-category drop was not classified as success: %+v", result)
	}
}

func TestPrivateDropClassifiesOfflineFailure(t *testing.T) {
	command := "drop@315@100000069@1"
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("目标玩家[315]不在线，无法发送物品。"),
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
	if result.DeliveryStatus != ChatDeliveryFailure || result.ServerResponse != "目标玩家[315]不在线，无法发送物品。" {
		t.Fatalf("offline drop was not classified as failure: %+v", result)
	}
	if snapshot := session.Snapshot(); snapshot.ChatSuccessCount != 0 || snapshot.ChatFailureCount != 1 || snapshot.ChatUnknownCount != 0 {
		t.Fatalf("unexpected drop failure counters: %+v", snapshot)
	}
}

func TestPrivateCommandReturnsPlayerNamePermissionFailure(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u73a9\u5bb6\u59d3\u540d\u3002"),
	}}
	session, err := New(client, Config{ChatResponseTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady

	result, err := session.SendPrivateChat(context.Background(), "drop@315@100000069@1")
	if err != nil {
		t.Fatal(err)
	}
	if result.DeliveryStatus != ChatDeliveryFailure || !IsPlayerNamePermissionResponse(result.ServerResponse) {
		t.Fatalf("permission response was not returned as a terminal failure: %+v", result)
	}
}

func TestPrivateDropIgnoresSelfNotificationUntilDeliveryResult(t *testing.T) {
	command := "drop@265@100000068@1"
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("GM赠送您物品[100000068]×1。"),
		systemEvent("已将物品[100000068]×1发送到玩家[REF]的背包。"),
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
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponse != "已将物品[100000068]×1发送到玩家[REF]的背包。" {
		t.Fatalf("self notification was treated as the result: %+v", result)
	}
}

func TestPrivateDropTimeoutIsUnknown(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{systemEvent("unrelated system event")}}
	session, err := New(client, Config{ChatResponseTimeout: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady

	result, err := session.SendPrivateChat(context.Background(), "drop@265@100000069@1")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != ChatStatusWrittenUnconfirmed || result.DeliveryStatus != ChatDeliveryUnknown || result.ServerResponseObserved {
		t.Fatalf("drop timeout was not left unknown: %+v", result)
	}
	if session.Snapshot().ChatUnknownCount != 1 {
		t.Fatalf("drop timeout was not counted: %+v", session.Snapshot())
	}
}

func TestStaleDropNotificationDoesNotAnswerNextChat(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("已将物品[100000069]×1发送到玩家[REF]的背包。"),
		systemEvent("GM赠送您物品[100000069]×1。"),
		systemEvent("next chat response"),
	}}
	session, err := New(client, Config{ChatResponseTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady

	if _, err := session.SendPrivateChat(context.Background(), "drop@265@100000069@1"); err != nil {
		t.Fatal(err)
	}
	result, err := session.SendChat(context.Background(), gameprotocol.WorldChatChannel, "hello")
	if err != nil {
		t.Fatal(err)
	}
	if result.ServerResponse != "next chat response" {
		t.Fatalf("stale drop notification answered next chat: %+v", result)
	}
}

func TestChatEchoMatchesObservedChannels(t *testing.T) {
	for _, channel := range []string{
		gameprotocol.PublicChatChannel,
		gameprotocol.GuildChatChannel,
		gameprotocol.TeamChatChannel,
		gameprotocol.WorldChatChannel,
		gameprotocol.PrivateChatChannel,
	} {
		eventID := 1
		message := gameprotocol.Message{
			Type:  "evt",
			Event: &eventID,
			Params: []gameprotocol.Param{
				{ID: 21, Value: channel},
				{ID: 23, Value: "hello"},
			},
		}

		observation, ok := matchChatResponse(message, channel, "hello")
		if !ok || observation.kind != "chat_echo" || observation.text != "hello" {
			t.Fatalf("chat echo was not matched for %s: %+v %t", channel, observation, ok)
		}
		if _, ok := matchChatResponse(message, "different-channel", "hello"); ok {
			t.Fatalf("chat echo matched the wrong channel for %s", channel)
		}
	}
}

func TestPrivateChatTimeoutRemainsUnconfirmed(t *testing.T) {
	client := &scriptedClient{}
	session, err := New(client, Config{ChatResponseTimeout: 5 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady

	result, err := session.SendPrivateChat(context.Background(), "hello")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != ChatStatusWrittenUnconfirmed || result.DeliveryStatus != ChatDeliveryUnknown || result.ServerResponseObserved {
		t.Fatalf("timeout was reported as a server result: %+v", result)
	}
}

func chatEcho(channel, messageText string) gameprotocol.Message {
	eventID := 1
	return gameprotocol.Message{
		Type:  "evt",
		Event: &eventID,
		Params: []gameprotocol.Param{
			{ID: 21, Value: channel},
			{ID: 23, Value: messageText},
		},
	}
}

func systemEvent(text string) gameprotocol.Message {
	eventID := 20
	return gameprotocol.Message{
		Type:  "evt",
		Event: &eventID,
		Params: []gameprotocol.Param{
			{ID: 36, Value: text},
			{ID: 65, Value: "System"},
		},
	}
}
