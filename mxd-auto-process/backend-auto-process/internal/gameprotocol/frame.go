package gameprotocol

import (
	"encoding/binary"
	"errors"
	"io"
)

const (
	DefaultMaxBodySize uint32 = 4 * 1024 * 1024
	MaxAllowedBodySize uint32 = 16 * 1024 * 1024
)

var ErrFrameTooLarge = errors.New("frame body is too large")

func EncodeFrame(body []byte, maxBodySize uint32) ([]byte, error) {
	maxBodySize = normalizedMaxBodySize(maxBodySize)
	if uint64(len(body)) > uint64(maxBodySize) || uint64(len(body)) > uint64(^uint32(0)) {
		return nil, ErrFrameTooLarge
	}

	frame := make([]byte, len(body)+4)
	binary.BigEndian.PutUint32(frame[:4], uint32(len(body)))
	copy(frame[4:], body)
	return frame, nil
}

func WriteFrame(writer io.Writer, body []byte, maxBodySize uint32) error {
	frame, err := EncodeFrame(body, maxBodySize)
	if err != nil {
		return err
	}
	return writeAll(writer, frame)
}

func ReadFrame(reader io.Reader, maxBodySize uint32) ([]byte, error) {
	var header [4]byte
	if _, err := io.ReadFull(reader, header[:]); err != nil {
		return nil, err
	}

	bodySize := binary.BigEndian.Uint32(header[:])
	maxBodySize = normalizedMaxBodySize(maxBodySize)
	if bodySize > maxBodySize {
		return nil, ErrFrameTooLarge
	}

	body := make([]byte, bodySize)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	return body, nil
}

func normalizedMaxBodySize(value uint32) uint32 {
	if value == 0 {
		return DefaultMaxBodySize
	}
	if value > MaxAllowedBodySize {
		return MaxAllowedBodySize
	}
	return value
}

func writeAll(writer io.Writer, data []byte) error {
	for len(data) > 0 {
		written, err := writer.Write(data)
		if err != nil {
			return err
		}
		if written == 0 {
			return io.ErrShortWrite
		}
		data = data[written:]
	}
	return nil
}
