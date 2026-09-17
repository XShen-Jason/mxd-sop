package gameprotocol

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"
)

func TestTCPReceiveStopsWhenContextIsCanceled(t *testing.T) {
	server, client := net.Pipe()
	defer server.Close()
	defer client.Close()

	tcpClient := NewTCPClient(client, 1024)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	result := make(chan error, 1)
	go func() {
		_, err := tcpClient.Receive(ctx)
		result <- err
	}()

	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("receive returned the wrong cancellation error: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("receive did not stop after context cancellation")
	}
}
