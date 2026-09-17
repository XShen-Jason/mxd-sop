package gameprotocol

const (
	PublicChatChannel  = "scene"
	GuildChatChannel   = "guild"
	TeamChatChannel    = "team"
	WorldChatChannel   = "world"
	PrivateChatChannel = "privateChat"
)

func IsChatChannel(channel string) bool {
	switch channel {
	case PublicChatChannel, GuildChatChannel, TeamChatChannel, WorldChatChannel, PrivateChatChannel:
		return true
	default:
		return false
	}
}

func Login(account, token, version string) Message {
	return NewOperation(0,
		Param{ID: 0, Value: account},
		Param{ID: 1, Value: token},
		Param{ID: 35, Value: version},
	)
}

func SelectCharacter(characterID, opaque string) Message {
	return NewOperation(6,
		Param{ID: 10, Value: characterID},
		Param{ID: 81, Value: opaque},
	)
}

func EnterMap(mapID string) Message {
	return NewOperation(7, Param{ID: 16, Value: mapID})
}

func PostEntryInit() Message {
	return NewOperation(8)
}

func PrivateChat(message string) Message {
	return Chat(PrivateChatChannel, message)
}

func Chat(channel, message string) Message {
	return NewOperation(10,
		Param{ID: 21, Value: channel},
		Param{ID: 23, Value: message},
	)
}
