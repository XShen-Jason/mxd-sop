package gamesession

import (
	"encoding/json"
	"io"
	"strings"

	"github.com/local/mxd-auto-process/internal/gameprotocol"
)

type roleCredential struct {
	option RoleOption
	opaque string
}

func extractRoleCredentials(message gameprotocol.Message) []roleCredential {
	roles := make([]roleCredential, 0, 4)
	for _, param := range message.Params {
		collectRoleValue(decodeStructuredValue(param.Value), &roles)
	}
	if characterID, ok := decodedStringParam(message, 10); ok {
		opaque := extractRoleOpaqueParam(message)
		appendRole(&roles, roleCredential{option: RoleOption{ID: characterID, OpaqueAvailable: opaque != ""}, opaque: opaque})
	}
	return roles
}

func collectRoleValue(value any, roles *[]roleCredential) {
	switch typed := value.(type) {
	case map[string]any:
		characterID := mapString(typed, "charid", "characterid", "character", "roleid")
		if characterID == "" {
			characterID = mapString(typed, "id")
		}
		name := mapString(typed, "name", "nickname", "playername", "charname", "charactername", "rolename")
		mapID := mapString(typed, "mapid", "map")
		opaque := mapString(typed, "opaque", "roleopaque", "sessionvalue", "field81")
		if characterID != "" && (name != "" || mapID != "" || opaque != "") {
			appendRole(roles, roleCredential{
				option: RoleOption{ID: characterID, Name: name, MapID: mapID, OpaqueAvailable: opaque != ""},
				opaque: opaque,
			})
		}
		for _, nested := range typed {
			collectRoleValue(nested, roles)
		}
	case []any:
		for _, nested := range typed {
			collectRoleValue(nested, roles)
		}
	}
}

func extractRoleOpaqueParam(message gameprotocol.Message) string {
	value, ok := message.Param(81)
	if !ok {
		return ""
	}
	decoded := decodeStructuredValue(value)
	if opaque, ok := gameprotocol.AsString(decoded); ok {
		return opaque
	}
	return findStringByKeys(decoded, "opaque", "roleopaque", "sessionvalue", "field81")
}

func appendRole(roles *[]roleCredential, candidate roleCredential) {
	for index := range *roles {
		if (*roles)[index].option.ID != candidate.option.ID {
			continue
		}
		if (*roles)[index].opaque == "" && candidate.opaque != "" {
			(*roles)[index].opaque = candidate.opaque
			(*roles)[index].option.OpaqueAvailable = true
		}
		if (*roles)[index].option.Name == "" {
			(*roles)[index].option.Name = candidate.option.Name
		}
		if (*roles)[index].option.MapID == "" {
			(*roles)[index].option.MapID = candidate.option.MapID
		}
		return
	}
	*roles = append(*roles, candidate)
}

func mapString(values map[string]any, names ...string) string {
	for key, value := range values {
		for _, name := range names {
			if normalizeKey(key) != normalizeKey(name) {
				continue
			}
			if result, ok := gameprotocol.AsString(value); ok {
				return result
			}
		}
	}
	return ""
}

func normalizeKey(value string) string {
	value = strings.ToLower(value)
	value = strings.ReplaceAll(value, "_", "")
	value = strings.ReplaceAll(value, "-", "")
	return value
}

func extractServerKey(message gameprotocol.Message, fieldID int) string {
	if fieldID != 0 {
		if value, ok := message.Param(fieldID); ok {
			decoded := decodeStructuredValue(value)
			for _, key := range []string{"serverkey", "key"} {
				if result := findStringInValue(decoded, key); result != "" {
					return result
				}
			}
			if result, ok := gameprotocol.AsString(decoded); ok {
				return result
			}
		}
	}
	for _, key := range []string{"serverkey", "key"} {
		if result := findStringByKey(message.Params, key); result != "" {
			return result
		}
	}
	return ""
}

func extractMapID(message gameprotocol.Message) string {
	if value, ok := decodedStringParam(message, 16); ok {
		return value
	}
	return findStringByKey(message.Params, "mapid")
}

func decodedStringParam(message gameprotocol.Message, id int) (string, bool) {
	value, ok := message.Param(id)
	if !ok {
		return "", false
	}
	return gameprotocol.AsString(decodeStructuredValue(value))
}

func findStringByKey(values []gameprotocol.Param, wanted string) string {
	for _, param := range values {
		if result := findStringInValue(decodeStructuredValue(param.Value), wanted); result != "" {
			return result
		}
	}
	return ""
}

func findStringByKeys(value any, wanted ...string) string {
	for _, key := range wanted {
		if result := findStringInValue(value, key); result != "" {
			return result
		}
	}
	return ""
}

func decodeStructuredValue(value any) any {
	switch typed := value.(type) {
	case string:
		var parsed any
		decoder := json.NewDecoder(strings.NewReader(typed))
		decoder.UseNumber()
		if err := decoder.Decode(&parsed); err != nil {
			return value
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			return value
		}
		return decodeStructuredValue(parsed)
	case map[string]any:
		decoded := make(map[string]any, len(typed))
		for key, nested := range typed {
			decoded[key] = decodeStructuredValue(nested)
		}
		return decoded
	case []any:
		decoded := make([]any, len(typed))
		for index, nested := range typed {
			decoded[index] = decodeStructuredValue(nested)
		}
		return decoded
	default:
		return value
	}
}

func findStringInValue(value any, wanted string) string {
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			if normalizeKey(key) == normalizeKey(wanted) {
				if result, ok := gameprotocol.AsString(nested); ok {
					return result
				}
			}
			if result := findStringInValue(nested, wanted); result != "" {
				return result
			}
		}
	case []any:
		for _, nested := range typed {
			if result := findStringInValue(nested, wanted); result != "" {
				return result
			}
		}
	}
	return ""
}

func eventContains(value any, expected string) bool {
	switch typed := value.(type) {
	case string:
		return strings.Contains(typed, expected)
	case map[string]any:
		for _, nested := range typed {
			if eventContains(nested, expected) {
				return true
			}
		}
	case []any:
		for _, nested := range typed {
			if eventContains(nested, expected) {
				return true
			}
		}
	}
	return false
}
