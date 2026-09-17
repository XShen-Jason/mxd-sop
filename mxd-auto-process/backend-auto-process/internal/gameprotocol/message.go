package gameprotocol

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type Param struct {
	ID    int
	Value any
}

func (p Param) MarshalJSON() ([]byte, error) {
	return json.Marshal([2]any{p.ID, p.Value})
}

func (p *Param) UnmarshalJSON(data []byte) error {
	var parts []json.RawMessage
	if err := json.Unmarshal(data, &parts); err != nil {
		return fmt.Errorf("parameter must be an array: %w", err)
	}
	if len(parts) != 2 {
		return fmt.Errorf("parameter must contain two values")
	}
	if err := json.Unmarshal(parts[0], &p.ID); err != nil {
		return fmt.Errorf("parameter id: %w", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(parts[1]))
	decoder.UseNumber()
	if err := decoder.Decode(&p.Value); err != nil {
		return fmt.Errorf("parameter value: %w", err)
	}
	return nil
}

type Message struct {
	Type   string  `json:"t"`
	Op     *int    `json:"op,omitempty"`
	RC     *int    `json:"rc,omitempty"`
	Event  *int    `json:"ev,omitempty"`
	Params []Param `json:"p"`
}

func NewOperation(operation int, params ...Param) Message {
	return Message{Type: "op", Op: intPointer(operation), Params: params}
}

func MarshalBody(message Message) ([]byte, error) {
	if message.Type == "" {
		return nil, fmt.Errorf("message type is required")
	}
	return json.Marshal(message)
}

func UnmarshalBody(data []byte) (Message, error) {
	var message Message
	if err := json.Unmarshal(data, &message); err != nil {
		return Message{}, fmt.Errorf("decode message: %w", err)
	}
	if message.Type == "" {
		return Message{}, fmt.Errorf("message type is required")
	}
	return message, nil
}

func (m Message) IsResponse(operation int) bool {
	return m.Type == "resp" && m.Op != nil && *m.Op == operation
}

func (m Message) IsEvent(event int) bool {
	return m.Type == "evt" && m.Event != nil && *m.Event == event
}

func (m Message) ResponseCode() (int, bool) {
	if m.RC == nil {
		return 0, false
	}
	return *m.RC, true
}

func (m Message) Param(id int) (any, bool) {
	for _, param := range m.Params {
		if param.ID == id {
			return param.Value, true
		}
	}
	return nil, false
}

func (m Message) StringParam(id int) (string, bool) {
	value, ok := m.Param(id)
	if !ok {
		return "", false
	}
	return AsString(value)
}

func AsString(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return typed, true
	case json.Number:
		return typed.String(), true
	case float64:
		return fmt.Sprintf("%v", typed), true
	case map[string]any:
		for _, key := range []string{"$i32", "$i64", "value"} {
			if nested, ok := typed[key]; ok {
				return AsString(nested)
			}
		}
	}
	return "", false
}

func intPointer(value int) *int {
	return &value
}
