package gamesession

import (
	"context"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

type chatResponseObservation struct {
	kind           string
	text           string
	code           *int
	event          int
	deliveryStatus string
}

func (s *Session) waitForChatResponse(ctx context.Context, channel, message string) (chatResponseObservation, error) {
	responseCtx, cancel := context.WithTimeout(ctx, s.config.ChatResponseTimeout)
	defer cancel()
	dropCommand, isDrop := parsePrivateDropCommand(channel, message)
	cashIDCommand, isCashID := parsePrivateCashIDCommand(channel, message)
	herwarpCommand, isHerwarp := parsePrivateHerwarpCommand(channel, message)
	banCommand, isBan := parsePrivateBanCommand(channel, message)
	for {
		incoming, err := s.receive(responseCtx, 10, "chat response")
		if err != nil {
			return chatResponseObservation{}, err
		}
		observation, ok := matchChatResponse(incoming, channel, message)
		if !ok {
			continue
		}
		if observation.kind == "system_event" && isKickedOutMessage(observation.text) {
			return observation, nil
		}
		if observation.kind == "system_event" && IsPlayerNamePermissionResponse(observation.text) {
			observation.deliveryStatus = ChatDeliveryFailure
			return observation, nil
		}
		if isDrop {
			if observation.kind == "system_event" {
				observation.deliveryStatus = classifyDropSystemMessage(observation.text, dropCommand)
				if observation.deliveryStatus != ChatDeliveryUnknown {
					return observation, nil
				}
			}
			continue
		}
		if isCashID {
			if observation.kind == "system_event" {
				observation.deliveryStatus = classifyCashIDSystemMessage(observation.text, cashIDCommand)
				if observation.deliveryStatus != ChatDeliveryUnknown {
					return observation, nil
				}
			}
			continue
		}
		if isHerwarp {
			if observation.kind == "system_event" {
				observation.deliveryStatus = classifyHerwarpSystemMessage(observation.text, herwarpCommand)
				if observation.deliveryStatus != ChatDeliveryUnknown {
					return observation, nil
				}
			}
			continue
		}
		if isBan {
			if observation.kind == "system_event" {
				observation.deliveryStatus = classifyBanSystemMessage(observation.text, banCommand)
				if observation.deliveryStatus != ChatDeliveryUnknown {
					return observation, nil
				}
			}
			continue
		}
		if observation.kind == "system_event" && (isKnownDropNotification(observation.text) || isKnownCashIDNotification(observation.text) || isKnownHerwarpNotification(observation.text) || isKnownBanNotification(observation.text)) {
			continue
		}
		observation.deliveryStatus = classifyChatObservation(observation, channel)
		return observation, nil
	}
}

func matchChatResponse(message gameprotocol.Message, channel, sentMessage string) (chatResponseObservation, bool) {
	if message.IsResponse(10) {
		code, ok := message.ResponseCode()
		if !ok {
			return chatResponseObservation{}, false
		}
		text, _ := message.StringParam(36)
		return chatResponseObservation{kind: "operation_response", text: text, code: intValuePointer(code)}, true
	}
	// 系统事件响应（包括被顶号和命令结果）
	if message.IsEvent(20) && isSystemEvent(message) {
		text, _ := message.StringParam(36)
		return chatResponseObservation{kind: "system_event", text: text, event: 20}, true
	}
	// 聊天回显
	if message.IsEvent(1) && matchesChatEcho(message, channel, sentMessage) {
		return chatResponseObservation{kind: "chat_echo", text: sentMessage, event: 1}, true
	}
	return chatResponseObservation{}, false
}

func isSystemEvent(message gameprotocol.Message) bool {
	source, ok := message.StringParam(65)
	return ok && source == "System"
}

func matchesChatEcho(message gameprotocol.Message, channel, sentMessage string) bool {
	observedChannel, channelOK := message.StringParam(21)
	observedMessage, messageOK := message.StringParam(23)
	return channelOK && messageOK && observedChannel == channel && observedMessage == sentMessage
}

func intValuePointer(value int) *int { return &value }
