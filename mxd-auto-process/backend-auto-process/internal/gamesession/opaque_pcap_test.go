package gamesession

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

func TestPCAPRoleOpaqueResolverMatchesSuccessfulSelection(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture.pcap")
	writeSyntheticPCAP(t, path, "capture-opaque", 0)
	resolver := NewPCAPRoleOpaqueResolver(path)

	opaque, found, err := resolver.Resolve(context.Background(), "45.117.11.230:12660", "315")
	if err != nil || !found || opaque != "capture-opaque" {
		t.Fatalf("unexpected resolver result: %q %t %v", opaque, found, err)
	}
}

func TestPCAPRoleOpaqueResolverRequiresSuccessfulResponse(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture.pcap")
	writeSyntheticPCAP(t, path, "capture-opaque", 1)
	resolver := NewPCAPRoleOpaqueResolver(path)

	_, found, err := resolver.Resolve(context.Background(), "45.117.11.230:12660", "315")
	if err != nil || found {
		t.Fatalf("failed selection was treated as a match: found=%t err=%v", found, err)
	}
}

func TestPCAPRoleOpaqueResolverRejectsConflictingValues(t *testing.T) {
	directory := t.TempDir()
	writeSyntheticPCAP(t, filepath.Join(directory, "a.pcap"), "opaque-a", 0)
	writeSyntheticPCAP(t, filepath.Join(directory, "b.pcap"), "opaque-b", 0)
	resolver := NewPCAPRoleOpaqueResolver(directory)

	_, found, err := resolver.Resolve(context.Background(), "45.117.11.230:12660", "315")
	if !errors.Is(err, ErrRoleOpaqueAmbiguous) || found {
		t.Fatalf("conflicting values were not rejected: found=%t err=%v", found, err)
	}
}

func TestPCAPRoleOpaqueResolverRechecksUpdatedCapture(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture.pcap")
	writeSyntheticPCAP(t, path, "opaque-a", 0)
	resolver := NewPCAPRoleOpaqueResolver(path)
	if opaque, found, err := resolver.Resolve(context.Background(), "45.117.11.230:12660", "315"); err != nil || !found || opaque != "opaque-a" {
		t.Fatalf("unexpected initial resolver result: %q %t %v", opaque, found, err)
	}

	writeSyntheticPCAP(t, path, "opaque-b", 0)
	if opaque, found, err := resolver.Resolve(context.Background(), "45.117.11.230:12660", "315"); err != nil || !found || opaque != "opaque-b" {
		t.Fatalf("resolver reused stale capture value: %q %t %v", opaque, found, err)
	}
}

func TestPCAPRoleOpaqueResolverFallsBackToServerValueForUnseenRole(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture.pcap")
	writeSyntheticPCAP(t, path, "capture-opaque", 0)
	resolver := NewPCAPRoleOpaqueResolver(path)
	opaque, found, err := resolver.Resolve(context.Background(), "45.117.11.230:12660", "unseen-role")
	if err != nil || !found || opaque != "capture-opaque" {
		t.Fatalf("unexpected fallback result: %q %t %v", opaque, found, err)
	}
}

func TestPCAPRoleOpaqueResolverRejectsConflictingFallbackValues(t *testing.T) {
	directory := t.TempDir()
	writeSyntheticPCAPForRole(t, filepath.Join(directory, "a.pcap"), "315", "opaque-a", 0)
	writeSyntheticPCAPForRole(t, filepath.Join(directory, "b.pcap"), "344", "opaque-b", 0)
	resolver := NewPCAPRoleOpaqueResolver(directory)

	_, found, err := resolver.Resolve(context.Background(), "45.117.11.230:12660", "unseen-role")
	if !errors.Is(err, ErrRoleOpaqueAmbiguous) || found {
		t.Fatalf("conflicting fallback values were not rejected: found=%t err=%v", found, err)
	}
}

func TestPCAPRoleOpaqueResolverUsesUnambiguousCaptureAcrossServerEndpoint(t *testing.T) {
	path := filepath.Join(t.TempDir(), "capture.pcap")
	writeSyntheticPCAP(t, path, "capture-opaque", 0)
	resolver := NewPCAPRoleOpaqueResolver(path)

	opaque, found, err := resolver.Resolve(context.Background(), "103.248.154.222:12660", "unseen-role")
	if err != nil || !found || opaque != "capture-opaque" {
		t.Fatalf("unexpected cross-endpoint fallback result: %q %t %v", opaque, found, err)
	}
}

func writeSyntheticPCAP(t *testing.T, path, opaque string, responseCode int) {
	writeSyntheticPCAPForRole(t, path, "315", opaque, responseCode)
}

func writeSyntheticPCAPForRole(t *testing.T, path, characterID, opaque string, responseCode int) {
	t.Helper()
	request := gameprotocol.SelectCharacter(characterID, opaque)
	operation, code := 6, responseCode
	response := gameprotocol.Message{Type: "resp", Op: &operation, RC: &code}
	requestFrame := marshalTestFrame(t, request)
	responseFrame := marshalTestFrame(t, response)

	data := make([]byte, 24)
	copy(data[:4], []byte{0xd4, 0xc3, 0xb2, 0xa1})
	binary.LittleEndian.PutUint16(data[4:6], 2)
	binary.LittleEndian.PutUint16(data[6:8], 4)
	binary.LittleEndian.PutUint32(data[20:24], 1)
	data = appendPCAPPacket(data, [4]byte{10, 0, 0, 1}, 40000, [4]byte{45, 117, 11, 230}, 12660, 100, requestFrame)
	data = appendPCAPPacket(data, [4]byte{45, 117, 11, 230}, 12660, [4]byte{10, 0, 0, 1}, 40000, 200, responseFrame)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func marshalTestFrame(t *testing.T, message gameprotocol.Message) []byte {
	t.Helper()
	body, err := gameprotocol.MarshalBody(message)
	if err != nil {
		t.Fatal(err)
	}
	frame, err := gameprotocol.EncodeFrame(body, 1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	return frame
}

func appendPCAPPacket(data []byte, sourceIP [4]byte, sourcePort uint16, destinationIP [4]byte, destinationPort uint16, sequence uint32, payload []byte) []byte {
	packet := make([]byte, 14+20+20+len(payload))
	ip := 14
	packet[ip] = 0x45
	binary.BigEndian.PutUint16(packet[ip+2:ip+4], uint16(40+len(payload)))
	packet[ip+8] = 64
	packet[ip+9] = 6
	copy(packet[ip+12:ip+16], sourceIP[:])
	copy(packet[ip+16:ip+20], destinationIP[:])
	tcp := ip + 20
	binary.BigEndian.PutUint16(packet[tcp:tcp+2], sourcePort)
	binary.BigEndian.PutUint16(packet[tcp+2:tcp+4], destinationPort)
	binary.BigEndian.PutUint32(packet[tcp+4:tcp+8], sequence)
	packet[tcp+12] = 0x50
	copy(packet[tcp+20:], payload)
	record := make([]byte, 16)
	binary.LittleEndian.PutUint32(record[8:12], uint32(len(packet)))
	binary.LittleEndian.PutUint32(record[12:16], uint32(len(packet)))
	return append(append(data, record...), packet...)
}
