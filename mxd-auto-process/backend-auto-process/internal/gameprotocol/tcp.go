package gameprotocol

import (
	"context"
	"net"
	"sync"
	"time"
)

type Client interface {
	Send(context.Context, Message) error
	Receive(context.Context) (Message, error)
	Close() error
}

type Dialer interface {
	Dial(context.Context, string, uint32) (Client, error)
}

type TCPDialer struct{}

func (TCPDialer) Dial(ctx context.Context, address string, maxBodySize uint32) (Client, error) {
	connection, err := (&net.Dialer{}).DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	return NewTCPClient(connection, maxBodySize), nil
}

type TCPClient struct {
	connection  net.Conn
	maxBodySize uint32
	writeMu     sync.Mutex
	closeOnce   sync.Once
	closeErr    error
}

func NewTCPClient(connection net.Conn, maxBodySize uint32) *TCPClient {
	return &TCPClient{connection: connection, maxBodySize: normalizedMaxBodySize(maxBodySize)}
}

func (c *TCPClient) Send(ctx context.Context, message Message) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	body, err := MarshalBody(message)
	if err != nil {
		return err
	}

	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.connection.SetWriteDeadline(contextDeadline(ctx)); err != nil {
		return err
	}
	defer c.connection.SetWriteDeadline(time.Time{})
	if err := WriteFrame(c.connection, body, c.maxBodySize); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}
	return nil
}

func (c *TCPClient) Receive(ctx context.Context) (Message, error) {
	if err := ctx.Err(); err != nil {
		return Message{}, err
	}
	if err := c.connection.SetReadDeadline(contextDeadline(ctx)); err != nil {
		return Message{}, err
	}
	cancelDone := make(chan struct{})
	stopCancel := context.AfterFunc(ctx, func() {
		_ = c.connection.SetReadDeadline(time.Now())
		close(cancelDone)
	})
	defer func() {
		if stopCancel() {
			close(cancelDone)
		}
		<-cancelDone
		_ = c.connection.SetReadDeadline(time.Time{})
	}()

	body, err := ReadFrame(c.connection, c.maxBodySize)
	if err != nil {
		if ctx.Err() != nil {
			return Message{}, ctx.Err()
		}
		return Message{}, err
	}
	message, err := UnmarshalBody(body)
	if err != nil {
		return Message{}, err
	}
	return message, nil
}

func (c *TCPClient) Close() error {
	c.closeOnce.Do(func() {
		c.closeErr = c.connection.Close()
	})
	return c.closeErr
}

func contextDeadline(ctx context.Context) time.Time {
	if deadline, ok := ctx.Deadline(); ok {
		return deadline
	}
	return time.Time{}
}
