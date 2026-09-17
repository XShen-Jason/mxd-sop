package gamesession

import (
	"context"
	"fmt"
	"net"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func serveSessionFixture(connection net.Conn, result chan<- error) {
	defer connection.Close()
	expect := func(operation int, check func(gameprotocol.Message) error) error {
		body, err := gameprotocol.ReadFrame(connection, 1024*1024)
		if err != nil {
			return err
		}
		message, err := gameprotocol.UnmarshalBody(body)
		if err != nil {
			return err
		}
		if message.Op == nil || *message.Op != operation {
			return fmt.Errorf("expected op %d, got %+v", operation, message)
		}
		return check(message)
	}
	respond := func(message gameprotocol.Message) error {
		body, err := gameprotocol.MarshalBody(message)
		if err != nil {
			return err
		}
		return gameprotocol.WriteFrame(connection, body, 1024*1024)
	}
	if err := expect(0, func(message gameprotocol.Message) error {
		if value, _ := message.StringParam(0); value != "test-account" {
			return fmt.Errorf("unexpected account")
		}
		if value, _ := message.StringParam(1); value != TokenFromPassword("test-password") {
			return fmt.Errorf("password was not converted to the protocol token")
		}
		return respond(loginResponse())
	}); err != nil {
		result <- err
		return
	}
	if err := expect(6, func(message gameprotocol.Message) error {
		if value, _ := message.StringParam(10); value != "role-1" {
			return fmt.Errorf("unexpected character")
		}
		if value, _ := message.StringParam(81); value != "fixture-opaque" {
			return fmt.Errorf("role opaque was not selected")
		}
		return respond(response(6, 0))
	}); err != nil {
		result <- err
		return
	}
	if err := expect(7, func(message gameprotocol.Message) error {
		if value, _ := message.StringParam(16); value != "211000000" {
			return fmt.Errorf("unexpected map")
		}
		if err := respond(response(7, 0)); err != nil {
			return err
		}
		if err := respond(event(2)); err != nil {
			return err
		}
		return respond(mapEvent("211000000:ch1"))
	}); err != nil {
		result <- err
		return
	}
	if err := expect(8, func(gameprotocol.Message) error { return respond(response(8, 0)) }); err != nil {
		result <- err
		return
	}
	if err := expect(10, func(message gameprotocol.Message) error {
		if value, _ := message.StringParam(21); value != "privateChat" {
			return fmt.Errorf("unexpected chat channel")
		}
		if value, _ := message.StringParam(23); value != "111" {
			return fmt.Errorf("unexpected chat body")
		}
		return respond(systemEvent("fixture chat response"))
	}); err != nil {
		result <- err
		return
	}
	result <- nil
}

func loginResponse() gameprotocol.Message {
	return messageWithParams(0, 0,
		gameprotocol.Param{ID: 1, Value: map[string]any{
			"serverKey":  "fixture-login-key",
			"characters": []any{map[string]any{"charid": "role-1", "name": "Fixture", "opaque": "fixture-opaque", "mapId": "211000000"}},
		}},
	)
}

func response(operation, code int) gameprotocol.Message {
	return messageWithParams(operation, code)
}

func event(eventID int) gameprotocol.Message {
	eventValue := eventID
	return gameprotocol.Message{Type: "evt", Event: &eventValue, Params: []gameprotocol.Param{}}
}

func mapEvent(value string) gameprotocol.Message {
	eventValue := 64
	return gameprotocol.Message{Type: "evt", Event: &eventValue, Params: []gameprotocol.Param{{ID: 64, Value: value}}}
}

func messageWithParams(operation, code int, params ...gameprotocol.Param) gameprotocol.Message {
	operationValue, codeValue := operation, code
	return gameprotocol.Message{Type: "resp", Op: &operationValue, RC: &codeValue, Params: params}
}

type scriptedClient struct {
	responses []gameprotocol.Message
	sent      []gameprotocol.Message
}

func (c *scriptedClient) Send(_ context.Context, message gameprotocol.Message) error {
	c.sent = append(c.sent, message)
	return nil
}

func (c *scriptedClient) Receive(ctx context.Context) (gameprotocol.Message, error) {
	if len(c.responses) == 0 {
		<-ctx.Done()
		return gameprotocol.Message{}, ctx.Err()
	}
	message := c.responses[0]
	c.responses = c.responses[1:]
	return message, nil
}

func (c *scriptedClient) Close() error { return nil }
