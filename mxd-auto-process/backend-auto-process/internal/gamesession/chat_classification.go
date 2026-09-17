package gamesession

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

type privateDropCommand struct {
	targetID string
	itemCode string
	quantity int
	valid    bool
}

type privateCashIDCommand struct {
	targetID string
	quantity int
	valid    bool
}

type privateHerwarpCommand struct {
	targetID string
	valid    bool
}

type privateBanCommand struct {
	targetID string
	valid    bool
}

var (
	// The server uses different labels (物品、装备、称号, …) for drop payloads.
	// Keep that label opaque while retaining the fixed success sentence and
	// exact item/quantity checks. Equipment responses may omit the × separator.
	dropSuccessMessage    = regexp.MustCompile(`^已将[^\[\]]+\[([^\]]+)\](?:×)?([0-9]+)发送到玩家\[([^\]]+)\]的背包。$`)
	dropOfflineMessage    = regexp.MustCompile(`^目标玩家\[([^\]]+)\]不在线，无法发送物品。$`)
	dropSelfNotification  = regexp.MustCompile(`^GM赠送您[^\[\]]+\[([^\]]+)\](?:×)?([0-9]+)。$`)
	cashIDSuccessMessage  = regexp.MustCompile(`^已给角色\[[^\]]+\(([^)]+)\)\]发放点券 ([0-9]+)$`)
	cashIDOfflineMessage  = regexp.MustCompile(`^角色id\[([^\]]+)\]不在线。给账号发点券\(支持离线\)请使用: zzdd@账号@数量$`)
	cashIDNotification    = regexp.MustCompile(`^GM\[[^\]]+\]给你发放点券: ([0-9]+)$`)
	herwarpSuccessMessage = regexp.MustCompile(`^已将玩家([^\s]+)传送到您身边。$`)
	herwarpOfflineMessage = regexp.MustCompile(`^玩家不在线无法传送。$`)
	banSuccessMessage     = regexp.MustCompile(`^已封禁角色\[[^\]]+\(([^)]+)\)\]。$`)
	banOfflineMessage     = regexp.MustCompile(`^角色\[([^\]]+)\]不在线,无法封禁\(需玩家在线时执行\)。$`)
)

const playerNamePermissionResponse = "\u8bf7\u8f93\u5165\u6b63\u786e\u7684\u73a9\u5bb6\u59d3\u540d\u3002"

// IsPlayerNamePermissionResponse identifies the game-server response that is
// emitted when the sending account cannot execute the private GM command.
func IsPlayerNamePermissionResponse(text string) bool {
	return strings.TrimSpace(text) == playerNamePermissionResponse
}

func parsePrivateDropCommand(channel, message string) (privateDropCommand, bool) {
	if channel != gameprotocol.PrivateChatChannel || !strings.HasPrefix(message, "drop@") {
		return privateDropCommand{}, false
	}
	parts := strings.Split(message, "@")
	if len(parts) != 4 || parts[1] == "" || parts[2] == "" {
		return privateDropCommand{}, true
	}
	quantity, err := strconv.Atoi(parts[3])
	if err != nil || quantity <= 0 {
		return privateDropCommand{}, true
	}
	return privateDropCommand{targetID: parts[1], itemCode: parts[2], quantity: quantity, valid: true}, true
}

func classifyDropSystemMessage(text string, command privateDropCommand) string {
	if !command.valid {
		return ChatDeliveryUnknown
	}
	if match := dropSuccessMessage.FindStringSubmatch(text); len(match) == 4 &&
		match[1] == command.itemCode && match[2] == strconv.Itoa(command.quantity) {
		return ChatDeliverySuccess
	}
	if match := dropOfflineMessage.FindStringSubmatch(text); len(match) == 2 && match[1] == command.targetID {
		return ChatDeliveryFailure
	}
	return ChatDeliveryUnknown
}

func parsePrivateCashIDCommand(channel, message string) (privateCashIDCommand, bool) {
	if channel != gameprotocol.PrivateChatChannel || !strings.HasPrefix(message, "cashid@") {
		return privateCashIDCommand{}, false
	}
	parts := strings.Split(message, "@")
	if len(parts) != 3 || parts[1] == "" {
		return privateCashIDCommand{}, true
	}
	quantity, err := strconv.Atoi(parts[2])
	if err != nil || quantity <= 0 {
		return privateCashIDCommand{}, true
	}
	return privateCashIDCommand{targetID: parts[1], quantity: quantity, valid: true}, true
}

func classifyCashIDSystemMessage(text string, command privateCashIDCommand) string {
	if !command.valid {
		return ChatDeliveryUnknown
	}
	if match := cashIDSuccessMessage.FindStringSubmatch(text); len(match) == 3 &&
		match[1] == command.targetID && match[2] == strconv.Itoa(command.quantity) {
		return ChatDeliverySuccess
	}
	if match := cashIDOfflineMessage.FindStringSubmatch(text); len(match) == 2 && match[1] == command.targetID {
		return ChatDeliveryFailure
	}
	return ChatDeliveryUnknown
}

func isKnownDropNotification(text string) bool {
	return dropSuccessMessage.MatchString(text) || dropOfflineMessage.MatchString(text) || dropSelfNotification.MatchString(text)
}

func isKnownCashIDNotification(text string) bool {
	return cashIDSuccessMessage.MatchString(text) || cashIDOfflineMessage.MatchString(text) || cashIDNotification.MatchString(text)
}

func parsePrivateHerwarpCommand(channel, message string) (privateHerwarpCommand, bool) {
	if channel != gameprotocol.PrivateChatChannel || !strings.HasPrefix(message, "herwarp@") {
		return privateHerwarpCommand{}, false
	}
	parts := strings.Split(message, "@")
	if len(parts) != 2 || parts[1] == "" {
		return privateHerwarpCommand{}, true
	}
	return privateHerwarpCommand{targetID: parts[1], valid: true}, true
}

func classifyHerwarpSystemMessage(text string, command privateHerwarpCommand) string {
	if !command.valid {
		return ChatDeliveryUnknown
	}
	if herwarpSuccessMessage.MatchString(text) {
		return ChatDeliverySuccess
	}
	if herwarpOfflineMessage.MatchString(text) {
		return ChatDeliveryFailure
	}
	return ChatDeliveryUnknown
}

func isKnownHerwarpNotification(text string) bool {
	return herwarpSuccessMessage.MatchString(text) || herwarpOfflineMessage.MatchString(text)
}

func parsePrivateBanCommand(channel, message string) (privateBanCommand, bool) {
	if channel != gameprotocol.PrivateChatChannel || !strings.HasPrefix(message, "ban@") {
		return privateBanCommand{}, false
	}
	parts := strings.Split(message, "@")
	if len(parts) != 2 || parts[1] == "" {
		return privateBanCommand{}, true
	}
	return privateBanCommand{targetID: parts[1], valid: true}, true
}

func classifyBanSystemMessage(text string, command privateBanCommand) string {
	if !command.valid {
		return ChatDeliveryUnknown
	}
	if match := banSuccessMessage.FindStringSubmatch(text); len(match) == 2 && match[1] == command.targetID {
		return ChatDeliverySuccess
	}
	if match := banOfflineMessage.FindStringSubmatch(text); len(match) == 2 && match[1] == command.targetID {
		return ChatDeliveryFailure
	}
	return ChatDeliveryUnknown
}

func isKnownBanNotification(text string) bool {
	return banSuccessMessage.MatchString(text) || banOfflineMessage.MatchString(text)
}

func classifyChatObservation(observation chatResponseObservation, channel string) string {
	switch observation.kind {
	case "chat_echo":
		return ChatDeliverySuccess
	case "operation_response":
		if observation.code != nil && *observation.code == 0 {
			return ChatDeliverySuccess
		}
		return ChatDeliveryFailure
	case "system_event":
		if channel == gameprotocol.GuildChatChannel && observation.text == "您还没有加入公会！" {
			return ChatDeliveryFailure
		}
	}
	return ChatDeliveryUnknown
}

func (s *Session) recordChatDeliveryLocked(status string) {
	switch status {
	case ChatDeliverySuccess:
		s.chatSuccessCount++
	case ChatDeliveryFailure:
		s.chatFailureCount++
	default:
		s.chatUnknownCount++
	}
	s.touchLocked()
}
