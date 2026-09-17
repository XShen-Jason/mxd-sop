package gamesession

import (
	"context"
	"testing"
	"time"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestPrivateCashIDIgnoresWalletBalanceAndSelfNotificationUntilSuccess(t *testing.T) {
	command := "cashid@265@10"
	client := &scriptedClient{responses: []gameprotocol.Message{
		walletBalanceEvent(8475),
		systemEvent("已给角色[REF(265)]发放点券 10"),
		systemEvent("GM[REF]给你发放点券: 10"),
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
	if result.DeliveryStatus != ChatDeliverySuccess || result.ServerResponse != "已给角色[REF(265)]发放点券 10" {
		t.Fatalf("cashid success was not classified: %+v", result)
	}
	if snapshot := session.Snapshot(); snapshot.ChatSuccessCount != 1 || snapshot.ChatFailureCount != 0 || snapshot.ChatUnknownCount != 0 {
		t.Fatalf("unexpected cashid success counters: %+v", snapshot)
	}
}

func TestPrivateCashIDClassifiesOfflineTargetFailure(t *testing.T) {
	command := "cashid@315@10"
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("角色id[315]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量"),
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
	if result.DeliveryStatus != ChatDeliveryFailure || result.ServerResponse != "角色id[315]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量" {
		t.Fatalf("cashid offline result was not classified: %+v", result)
	}
	if snapshot := session.Snapshot(); snapshot.ChatSuccessCount != 0 || snapshot.ChatFailureCount != 1 || snapshot.ChatUnknownCount != 0 {
		t.Fatalf("unexpected cashid failure counters: %+v", snapshot)
	}
}

func TestCashIDRequiresMatchingCharacterAndQuantity(t *testing.T) {
	command, recognized := parsePrivateCashIDCommand(gameprotocol.PrivateChatChannel, "cashid@265@10")
	if !recognized || !command.valid {
		t.Fatal("cashid command was not parsed")
	}
	for _, text := range []string{
		"已给角色[REF(315)]发放点券 10",
		"已给角色[REF(265)]发放点券 1",
	} {
		if status := classifyCashIDSystemMessage(text, command); status != ChatDeliveryUnknown {
			t.Fatalf("mismatched cashid result was classified as %s: %q", status, text)
		}
	}
}

func TestStaleCashIDNotificationDoesNotAnswerNextChat(t *testing.T) {
	client := &scriptedClient{responses: []gameprotocol.Message{
		systemEvent("已给角色[REF(265)]发放点券 1"),
		systemEvent("GM[REF]给你发放点券: 1"),
		systemEvent("next chat response"),
	}}
	session, err := New(client, Config{ChatResponseTimeout: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	session.state = StateReady

	if _, err := session.SendPrivateChat(context.Background(), "cashid@265@1"); err != nil {
		t.Fatal(err)
	}
	result, err := session.SendChat(context.Background(), gameprotocol.WorldChatChannel, "hello")
	if err != nil {
		t.Fatal(err)
	}
	if result.ServerResponse != "next chat response" {
		t.Fatalf("stale cashid notification answered next chat: %+v", result)
	}
}

func walletBalanceEvent(balance int) gameprotocol.Message {
	eventID := 63
	return gameprotocol.Message{
		Type:  "evt",
		Event: &eventID,
		Params: []gameprotocol.Param{
			{ID: 65, Value: "WalletBalance"},
			{ID: 53, Value: balance},
			{ID: 54, Value: 0},
		},
	}
}
