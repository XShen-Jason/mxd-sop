package gameprotocol

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestPrivateChatOperationMatchesWireShape(t *testing.T) {
	body, err := MarshalBody(PrivateChat("111"))
	if err != nil {
		t.Fatal(err)
	}
	expected := `{"t":"op","op":10,"p":[[21,"privateChat"],[23,"111"]]}`
	if string(body) != expected {
		t.Fatalf("unexpected body: %s", body)
	}
	frame, err := EncodeFrame(body, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if binary.BigEndian.Uint32(frame[:4]) != uint32(len(body)) {
		t.Fatalf("length prefix does not count JSON body")
	}
}

func TestPublicChatOperationUsesSceneChannel(t *testing.T) {
	body, err := MarshalBody(Chat(PublicChatChannel, "111"))
	if err != nil {
		t.Fatal(err)
	}
	expected := `{"t":"op","op":10,"p":[[21,"scene"],[23,"111"]]}`
	if string(body) != expected {
		t.Fatalf("unexpected body: %s", body)
	}
}

func TestChatOperationsUseObservedChannels(t *testing.T) {
	tests := []struct {
		name    string
		channel string
	}{
		{name: "all players", channel: PublicChatChannel},
		{name: "guild", channel: GuildChatChannel},
		{name: "team", channel: TeamChatChannel},
		{name: "world", channel: WorldChatChannel},
		{name: "private", channel: PrivateChatChannel},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body, err := MarshalBody(Chat(test.channel, "111"))
			if err != nil {
				t.Fatal(err)
			}
			expected := `{"t":"op","op":10,"p":[[21,"` + test.channel + `"],[23,"111"]]}`
			if string(body) != expected {
				t.Fatalf("unexpected body: %s", body)
			}
		})
	}
}

func TestLoginOperationKeepsZeroOperationField(t *testing.T) {
	body, err := MarshalBody(Login("test-account", "test-token", "1.0.2"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body, []byte(`"op":0`)) {
		t.Fatalf("login body omitted op=0: %s", body)
	}
	message, err := UnmarshalBody(body)
	if err != nil {
		t.Fatal(err)
	}
	if message.Op == nil || *message.Op != 0 {
		t.Fatalf("operation field did not round-trip: %+v", message)
	}
}

func TestUnmarshalPreservesTaggedIntegerAsString(t *testing.T) {
	message, err := UnmarshalBody([]byte(`{"t":"resp","op":7,"rc":0,"p":[[34,{"$i32":1}]]}`))
	if err != nil {
		t.Fatal(err)
	}
	value, ok := message.StringParam(34)
	if !ok || value != "1" {
		t.Fatalf("unexpected tagged integer: %q", value)
	}
}
