package gamesession

import (
	"strings"
)

// ErrKickedOut 被顶号的错误（已在types.go中定义，这里不重复定义）

// isKickedOutMessage 检测是否是被顶号消息
func isKickedOutMessage(text string) bool {
	text = strings.ToLower(text)

	// 检测中文提示
	if strings.Contains(text, "其他设备登录") ||
		strings.Contains(text, "已被下线") ||
		strings.Contains(text, "其他地方登录") {
		return true
	}

	// 检测英文提示
	if strings.Contains(text, "logged in elsewhere") ||
		strings.Contains(text, "another device") ||
		strings.Contains(text, "duplicate login") {
		return true
	}

	return false
}

// handleChatResponse 处理聊天响应，检测被顶号
func (s *Session) handleChatResponse(observation chatResponseObservation) error {
	// 检查是否是被顶号的系统事件（必须是被顶号，不是其他系统消息）
	if observation.kind == "system_event" && isKickedOutMessage(observation.text) {
		return ErrKickedOut
	}
	// 其他系统事件（如命令结果）不是错误
	return nil
}
