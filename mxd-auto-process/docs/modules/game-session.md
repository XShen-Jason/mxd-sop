# game-session

## Purpose

Own the observed framed TCP protocol and the ordered login, role selection, map
entry, post-entry initialization, five-channel chat operations, and private
command-result classification.

## Scope

In scope: frame safety, JSON operation construction, response matching, map
initialization readiness, runtime-only session state, chat write status, and
explicit keyless protocol experiments. Out of scope: server discovery,
credential storage, retries across sessions, game automation loops, and general
vulnerability scanning.

## Ownership and invariants

- A frame is a 4-byte big-endian JSON body length followed by UTF-8 JSON.
- Login success must be observed before character selection.
- Selection uses the role opaque value, never the login server key.
- A runtime password becomes the login token by taking the middle 16
  hexadecimal characters of its lowercase MD5 digest.
- An already-derived 16-character MD5 login value is accepted as a protocol
  token and sent unchanged.
- Map entry uses the selected character's map ID from `resp op=6` when
  available, otherwise the configured map ID, and requires `resp op=7 rc=0`
  plus the configured initialization events by default.
- Chat uses `op=10`, field 21=`scene`, `guild`, `team`, `world`, or
  `privateChat`, and field 23=message.
- After writing a chat frame, the session waits for a bounded response window.
  It recognizes `resp op=10`, a matching `evt=1` chat echo, or an `evt=20`
  System event and returns the server's text when present. Private `drop` and
  `cashid`, `herwarp`, and `ban` commands ignore their chat echo and unrelated
  system notifications, then match their command-specific terminal text.
  `drop` treats the category label as opaque because the server can report
  `物品`, `装备`, `称号`, or another category. It still requires the fixed
  success sentence, exact item code, and exact quantity; the `×` separator
  before the quantity is optional for compatibility with equipment responses.
  `cashid` also ignores the intermediate `evt=63` `WalletBalance` event. The
  result exposes `delivery_status` (`success`, `failure`, or `unknown`) apart
  from transport observation status. For `ban@<characterId>`, the success form
  `已封禁角色[<name>(<characterId>)]。` and the offline failure form
  `角色[<characterId>]不在线,无法封禁(需玩家在线时执行)。` must match the
  outstanding character ID. A timeout remains
  `written_unconfirmed`/`unknown`; no status claims business success without a
  matching command result. Results also expose
  `game_server_response_latency_ms` from the chat frame write to the matching
  response or bounded timeout, plus `game_server_status` with the same
  success/failure/unknown classification.
- The session snapshot keeps success, failure, and unknown delivery counters
  for written chat frames. Follow-up system notifications are not counted as
  additional sends.
- Heartbeats and business operations share one transport lock. While a chat or
  another business operation is in flight, the scheduled heartbeat is skipped;
  asynchronous `evt=18` messages are ignored while the chat waits for its
  command-specific terminal result.
- When a login response supplies a role opaque, the session automatically
  carries it into the matching `op=6` request. No separate opaque-fetch
  operation is implemented until a successful capture identifies its wire
  contract.

## Public surface

The `gamesession.Session` methods are `Login`, `SelectCharacter`, `EnterGame`,
`SendChat`, `SendPrivateChat`, `SendPrivateChatWithoutKey`, `ProtocolState`, `Snapshot`,
and `Close`. `RoleOpaqueResolver` and `NewPCAPRoleOpaqueResolver` provide the
optional automatic field 81 source. A fresh-connection probe uses
`ProbePrivateChatWithoutLogin`. The TCP adapter is selected through
`gameprotocol.Dialer` and `gameprotocol.Client` interfaces.

## Dependencies

Go `net`, `encoding/json`, and a configured TCP endpoint. No persistence or
third-party protocol dependency is required.

## Data, configuration, and assets

Session keys, credentials, role opaque values, and raw responses are held only
in memory. Login character data and server-key objects may arrive as
JSON-encoded strings and are decoded at the protocol boundary. The current
observed login captures do not provide the field 81 role opaque. A newer login
response that includes the value is parsed and used automatically. Otherwise,
a runtime resolver may supply it from a successful matching capture (or one
  unambiguous value for the same server when the role is new, or one
  unambiguous shared capture when the endpoint has no local evidence), so the
  operator does not need to enter the value. Server-specific version,
  map ID, request/response timeouts, retention mode, and optional heartbeat
  settings come from the server catalog. The protocol version defaults to
  `1.0.2` when omitted and may be overridden independently for each server.
  The opt-in
`minimal` retention mode discards login-derived key/role state and requires a
selection-time opaque source, either an explicit compatibility value or the
resolver. Missing or ambiguous automatic input does not destroy the logged-in
state, so selection can be retried. Keyless methods report
only frame-write success; they do not claim server-side authorization
acceptance.

## Tests

Frame fragmentation/coalescing, exact operation payloads, ordered flow,
response errors, initialization timeout, five-channel chat server-event and
timeout results, and minimal-retention behavior are covered by local fixture
tests.

## Migration notes

The observed protocol is clear-text and capture-derived. If a server changes
framing, field IDs, encryption, or response semantics, add a new protocol
adapter/version rather than weakening the existing checks.
