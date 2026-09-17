package gameprotocol

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

func TestReadFrameHandlesFragmentedAndCoalescedInput(t *testing.T) {
	first, err := EncodeFrame([]byte(`{"one":1}`), 1024)
	if err != nil {
		t.Fatal(err)
	}
	second, err := EncodeFrame([]byte(`{"two":2}`), 1024)
	if err != nil {
		t.Fatal(err)
	}
	reader := &chunkReader{data: append(first, second...), chunkSize: 2}
	gotFirst, err := ReadFrame(reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	gotSecond, err := ReadFrame(reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if string(gotFirst) != `{"one":1}` || string(gotSecond) != `{"two":2}` {
		t.Fatalf("unexpected frames: %q and %q", gotFirst, gotSecond)
	}
}

func TestFrameSizeIsBoundedBeforeBodyAllocation(t *testing.T) {
	var input [4]byte
	binary.BigEndian.PutUint32(input[:], 1025)
	_, err := ReadFrame(bytes.NewReader(input[:]), 1024)
	if !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("expected ErrFrameTooLarge, got %v", err)
	}
	if _, err := EncodeFrame(make([]byte, 1025), 1024); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("expected EncodeFrame to reject oversized body, got %v", err)
	}
}

func TestWriteFrameSupportsShortWrites(t *testing.T) {
	writer := &shortWriter{limit: 1}
	body := []byte(`{"message":"111"}`)
	if err := WriteFrame(writer, body, 1024); err != nil {
		t.Fatal(err)
	}
	decoded, err := ReadFrame(bytes.NewReader(writer.data.Bytes()), 1024)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(decoded, body) {
		t.Fatalf("body changed during write: %q", decoded)
	}
}

type chunkReader struct {
	data      []byte
	chunkSize int
}

func (r *chunkReader) Read(target []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	count := r.chunkSize
	if count > len(target) {
		count = len(target)
	}
	if count > len(r.data) {
		count = len(r.data)
	}
	copy(target, r.data[:count])
	r.data = r.data[count:]
	return count, nil
}

type shortWriter struct {
	data  bytes.Buffer
	limit int
}

func (w *shortWriter) Write(data []byte) (int, error) {
	count := w.limit
	if count > len(data) {
		count = len(data)
	}
	_, _ = w.data.Write(data[:count])
	return count, nil
}
