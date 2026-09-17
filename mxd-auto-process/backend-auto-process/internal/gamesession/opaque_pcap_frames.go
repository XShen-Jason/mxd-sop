package gamesession

import (
	"encoding/binary"
	"fmt"
	"net"
	"sort"
	"strconv"
	"strings"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

const maxCaptureFrameBody = 4 * 1024 * 1024

type pcapConnection struct {
	toServer   []tcpSegment
	fromServer []tcpSegment
}

type tcpSegment struct {
	sequence uint32
	order    int
	data     []byte
}

func extractPCAPRoleOpaque(data []byte, serverAddress, characterID string) []string {
	matched, _ := extractPCAPRoleOpaques(data, serverAddress, characterID)
	return matched
}

func extractPCAPRoleOpaques(data []byte, serverAddress, characterID string) ([]string, []string) {
	connections := parsePCAPConnections(data, serverAddress)
	matched := make([]string, 0, 1)
	all := make([]string, 0, 1)
	matchedSeen := make(map[string]struct{})
	allSeen := make(map[string]struct{})
	for _, connection := range connections {
		requests := selectRequests(assembleSegments(connection.toServer))
		responses := selectResponses(assembleSegments(connection.fromServer))
		for index, request := range requests {
			if index >= len(responses) || responses[index] != 0 || request.opaque == "" {
				continue
			}
			if _, ok := allSeen[request.opaque]; !ok {
				allSeen[request.opaque] = struct{}{}
				all = append(all, request.opaque)
			}
			if request.characterID == characterID {
				if _, ok := matchedSeen[request.opaque]; !ok {
					matchedSeen[request.opaque] = struct{}{}
					matched = append(matched, request.opaque)
				}
			}
		}
	}
	return matched, all
}

func parsePCAPConnections(data []byte, serverAddress string) map[string]*pcapConnection {
	order, linkType, ok := captureHeader(data)
	if !ok || linkType != 1 {
		return nil
	}
	matchAnyServer := strings.TrimSpace(serverAddress) == ""
	serverHost, serverPort, ok := splitServerAddress(serverAddress)
	if !matchAnyServer && !ok {
		return nil
	}
	connections := make(map[string]*pcapConnection)
	offset, packetOrder := 24, 0
	for offset+16 <= len(data) {
		included := int(order.Uint32(data[offset+8 : offset+12]))
		packetStart := offset + 16
		packetEnd := packetStart + included
		if included <= 0 || packetEnd > len(data) {
			break
		}
		packet := data[packetStart:packetEnd]
		if payload, source, destination, sequence, ok := tcpPayload(packet); ok {
			srcIP, srcPort := source.ip, source.port
			dstIP, dstPort := destination.ip, destination.port
			var key string
			var toServer bool
			switch {
			case matchAnyServer && dstPort == 12660:
				key = fmt.Sprintf("%s:%d", srcIP, srcPort)
				toServer = true
			case matchAnyServer && srcPort == 12660:
				key = fmt.Sprintf("%s:%d", dstIP, dstPort)
			case matchesServer(dstIP, dstPort, serverHost, serverPort):
				key = fmt.Sprintf("%s:%d", srcIP, srcPort)
				toServer = true
			case matchesServer(srcIP, srcPort, serverHost, serverPort):
				key = fmt.Sprintf("%s:%d", dstIP, dstPort)
			default:
				offset = packetEnd
				packetOrder++
				continue
			}
			connection := connections[key]
			if connection == nil {
				connection = &pcapConnection{}
				connections[key] = connection
			}
			segment := tcpSegment{sequence: sequence, order: packetOrder, data: payload}
			if toServer {
				connection.toServer = append(connection.toServer, segment)
			} else {
				connection.fromServer = append(connection.fromServer, segment)
			}
		}
		offset = packetEnd
		packetOrder++
	}
	return connections
}

type tcpEndpoint struct {
	ip   string
	port uint16
}

func tcpPayload(packet []byte) ([]byte, tcpEndpoint, tcpEndpoint, uint32, bool) {
	const ethernetHeader = 14
	if len(packet) < ethernetHeader+20 || packet[ethernetHeader]>>4 != 4 {
		return nil, tcpEndpoint{}, tcpEndpoint{}, 0, false
	}
	ipOffset := ethernetHeader
	ipHeader := int(packet[ipOffset]&0x0f) * 4
	if ipHeader < 20 || ipOffset+ipHeader+20 > len(packet) || packet[ipOffset+9] != 6 {
		return nil, tcpEndpoint{}, tcpEndpoint{}, 0, false
	}
	totalLength := int(binary.BigEndian.Uint16(packet[ipOffset+2 : ipOffset+4]))
	if totalLength < ipHeader+20 || ipOffset+totalLength > len(packet) {
		return nil, tcpEndpoint{}, tcpEndpoint{}, 0, false
	}
	tcpOffset := ipOffset + ipHeader
	tcpHeader := int(packet[tcpOffset+12]>>4) * 4
	if tcpHeader < 20 || tcpOffset+tcpHeader > ipOffset+totalLength {
		return nil, tcpEndpoint{}, tcpEndpoint{}, 0, false
	}
	source := tcpEndpoint{ip: net.IP(packet[ipOffset+12 : ipOffset+16]).String(), port: binary.BigEndian.Uint16(packet[tcpOffset : tcpOffset+2])}
	destination := tcpEndpoint{ip: net.IP(packet[ipOffset+16 : ipOffset+20]).String(), port: binary.BigEndian.Uint16(packet[tcpOffset+2 : tcpOffset+4])}
	payloadStart := tcpOffset + tcpHeader
	payload := append([]byte(nil), packet[payloadStart:ipOffset+totalLength]...)
	return payload, source, destination, binary.BigEndian.Uint32(packet[tcpOffset+4 : tcpOffset+8]), len(payload) > 0
}

func captureHeader(data []byte) (binary.ByteOrder, uint32, bool) {
	if len(data) < 24 {
		return nil, 0, false
	}
	littleMagic := binary.LittleEndian.Uint32(data[:4])
	if littleMagic == 0xa1b2c3d4 || littleMagic == 0xa1b23c4d {
		return binary.LittleEndian, binary.LittleEndian.Uint32(data[20:24]), true
	}
	bigMagic := binary.BigEndian.Uint32(data[:4])
	if bigMagic == 0xa1b2c3d4 || bigMagic == 0xa1b23c4d {
		return binary.BigEndian, binary.BigEndian.Uint32(data[20:24]), true
	}
	return nil, 0, false
}

func splitServerAddress(address string) (string, uint16, bool) {
	host, portText, err := net.SplitHostPort(address)
	if err != nil {
		return "", 0, false
	}
	port, err := strconv.ParseUint(portText, 10, 16)
	return host, uint16(port), err == nil
}

func matchesServer(ip string, port uint16, host string, serverPort uint16) bool {
	if port != serverPort {
		return false
	}
	expected := net.ParseIP(host)
	if expected == nil {
		return strings.EqualFold(ip, host)
	}
	return expected.Equal(net.ParseIP(ip))
}

func assembleSegments(segments []tcpSegment) []byte {
	sort.SliceStable(segments, func(i, j int) bool {
		if segments[i].sequence == segments[j].sequence {
			return segments[i].order < segments[j].order
		}
		return segments[i].sequence < segments[j].sequence
	})
	assembled := make([]byte, 0)
	var next uint32
	for index, segment := range segments {
		if index == 0 {
			next = segment.sequence
		}
		if segment.sequence > next {
			continue
		}
		overlap := int(next - segment.sequence)
		if overlap >= len(segment.data) {
			continue
		}
		assembled = append(assembled, segment.data[overlap:]...)
		next += uint32(len(segment.data) - overlap)
	}
	return assembled
}

type selectRequest struct {
	characterID string
	opaque      string
}

func selectRequests(data []byte) []selectRequest {
	requests := make([]selectRequest, 0)
	for _, message := range captureFrames(data) {
		if message.Type != "op" || message.Op == nil || *message.Op != 6 {
			continue
		}
		characterID, characterOK := message.StringParam(10)
		opaque, opaqueOK := message.StringParam(81)
		if characterOK && opaqueOK {
			requests = append(requests, selectRequest{characterID: characterID, opaque: opaque})
		}
	}
	return requests
}

func selectResponses(data []byte) []int {
	responses := make([]int, 0)
	for _, message := range captureFrames(data) {
		if !message.IsResponse(6) {
			continue
		}
		code, ok := message.ResponseCode()
		if ok {
			responses = append(responses, code)
		}
	}
	return responses
}

func captureFrames(data []byte) []gameprotocol.Message {
	frames := make([]gameprotocol.Message, 0)
	for offset := 0; offset+4 <= len(data); {
		bodyLength := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		if bodyLength <= 0 || bodyLength > maxCaptureFrameBody || offset+4+bodyLength > len(data) {
			break
		}
		message, err := gameprotocol.UnmarshalBody(data[offset+4 : offset+4+bodyLength])
		if err != nil {
			break
		}
		frames = append(frames, message)
		offset += 4 + bodyLength
	}
	return frames
}
