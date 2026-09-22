# game-session

Owner: `game-session`
Version: `v1`
Consumers: `session-control`

## Request/event

Each message is `uint32` big-endian body length followed by a UTF-8 compact JSON
body. Requests use `{"t":"op","op":N,"p":[[field,value],...]}`.

The supported operations are:

| Operation | Request parameters | Success condition |
| --- | --- | --- |
| login `op=0` | field 0 account, field 1 login token, field 35 client version | `resp`, op 0, `rc=0` |
| select `op=6` | field 10 character ID, 81 role opaque | `resp`, op 6, `rc=0` |
| enter `op=7` | field 16 map ID returned by `op=6`, or configured fallback | `resp`, op 7, `rc=0`, then map initialization |
| post-entry init `op=8` | no parameters | `resp`, op 8, `rc=0` |
| chat `op=10` | field 21=`scene`, `guild`, `team`, `world`, or `privateChat`; field 23 message | frame written, then bounded matching event observation |

Field 35 uses the selected server catalog entry's protocol version. Each
server stores its own value; omitted versions default to `1.0.2`.

## Response/handling

The client ignores unrelated framed messages while waiting for the matching
response. For ordinary chat, the matching forms observed in captures are
`resp op=10`, `evt=1` with the same channel and message text, and `evt=20` with
field 65 set to `System`; field 36 is returned as the server response text.
Private `drop@target@item@quantity` and `cashid@character@quantity` commands
are handled separately. A matching `evt=1` echo and the command's self-
notification are ignored until the command-result System message arrives.
`drop` matches the category/item and quantity success form or target-offline
failure form. The server may use different category labels (for example `物品`,
`装备`, or `称号`); the category is treated as opaque. It may also include or
omit the `×` separator before the quantity. The item code and quantity must
still match the outstanding command.
`cashid` matches the character/quantity success form
`已给角色[<name>(<characterId>)]发放点券 <quantity>` or the offline form
`角色id[<characterId>]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量`.
The latter means the original credit was not issued and is `failure`.
`cashid`'s intermediate `evt=63` `WalletBalance` event is not a terminal
response. `herwarp@<characterId>` matches `已将玩家<name>传送到您身边。`
as `success` and `玩家不在线无法传送。` as `failure`; the observed herwarp
messages do not include the requested character ID. `ban@<characterId>` ignores
the `evt=1` system broadcast and matches
`已封禁角色[<name>(<characterId>)]。` as `success` only when the character ID
matches. It also matches
`角色[<characterId>]不在线,无法封禁(需玩家在线时执行)。` as `failure` only
when the character ID matches. Only a matching command result is success or
failure.
The protocol has no request ID, so only one business command is outstanding on a
connection at a time. If no matching terminal event arrives within the
configured chat response timeout, the result is `written_unconfirmed` with
delivery status `unknown`, never success. The observed channel mapping and
response forms are recorded in `docs/PCAP_CHAT_ANALYSIS_20_58_35.md`; the
command-specific forms are recorded in
`docs/PCAP_DROP_RESULTS_00_47_27.md`,
`docs/PCAP_COMMAND_RESULTS_16_46_18.md`, and
`docs/PCAP_CASHID_RESULTS_01_21_00.md`,
`docs/PCAP_HERWARP_RESULTS_01_29_13.md`, and
`docs/PCAP_BAN_RESULTS_01_31_37.md` and
`docs/PCAP_BAN_RESULTS_02_32_00.md`. Map readiness requires
event 2 and event 64 containing the configured map ID unless the server
definition disables this compatibility check. The empty-map `op=7` preflight is
not sent because the captures show it is optional.

Chat results also expose `game_server_response_latency_ms`, measured from the
chat frame write until the matching terminal response or the bounded response
timeout, and `game_server_status`, which mirrors the `success`, `failure`, or
`unknown` delivery classification.

The observed login response uses JSON-encoded strings for the character object
and server key object. The client decodes those structured strings before
extracting `charid`, `nickname`, `mapId`, and the server key (`key` or
`serverKey`). The successful character-selection response is also the
authoritative source for that character's `mapId`; the configured map ID is
used only when the response does not provide one. If a login response includes a role opaque inside the role
object or as field 81, selection uses that value automatically for the
matching character. The value is resolved afresh for each login/selection
flow and is never replaced with the server key.

The current capture set does not include a separate server request that
returns field 81, and its login responses omit the role opaque. Therefore the
implementation does not invent an operation number or request shape for such
an exchange. When the login response omits the value, selection tries the
configured automatic capture resolver before returning
`missing_role_opaque`. The resolver can use a role-specific successful capture
or an unambiguous successful value for the same server when the role is new.
That local error does not fail the logged-in session, so selection can be
retried after matching evidence is available.

## Errors

Stable local errors include `invalid_state`, `missing_credential`,
`missing_role_opaque`, `role_opaque_ambiguous`, `timeout`, `map_initialization_timeout`,
`remote_error`, `invalid_frame`, and `closed`. A non-zero remote `rc` is never
treated as success.

## Limits and side effects

Frames default to 4 MiB; chat messages default to 512 Unicode code points.
Operations use configured deadlines, including a three-second default chat
response window. One session has at most one ordered business operation in
flight. `ChatResult.delivery_status` is the business classification and is
independent from `status`, which describes whether a server response was
observed. Session snapshots retain bounded success, failure, and unknown chat
counters in memory. A server event is evidence of a response, not a universal
business success signal; command-specific success interpretation remains
server-message dependent. The normal retention mode is memory-only `session`;
the opt-in `minimal` mode discards login-derived key/role state.

## Compatibility

The field 81 role opaque value is distinct from any server key returned by
login. Selection first uses a value returned with the role, then may resolve a
value from configured successful `op=6` PCAP evidence in memory. The resolver
prefers a value captured for the selected role; when that role is new, one
unambiguous value captured for the same server endpoint is also valid. If the
endpoint has no local capture, the bounded capture set may provide one
unambiguous shared value across its game-server endpoints. It requires a
successful `resp op=6 rc=0`, never substitutes the login server key, and
rejects conflicting captured values as ambiguous.
When a runtime password is supplied, the session derives field 1 by taking the
middle 16 hexadecimal characters of the lowercase MD5 digest. A caller that
already has that 16-character hexadecimal login value may supply it as the
protocol token; the session sends it unchanged and does not hash, normalize, or
slice it again. This is a protocol compatibility rule, not a password-storage
scheme.

## Diagnostic experiments

`server_key` is exposed only through the explicit operator diagnostic route. The
same-connection keyless test discards the locally retained server key and sends
the observed `op=10` frame. The fresh-connection test sends only `op=10` on a
new TCP connection and skips login, character selection, and map entry. A
successful TCP write is not proof that the server accepted or delivered the
message.

## Examples

```json
{"t":"op","op":10,"p":[[21,"scene"],[23,"111"]]}
```

The other observed channel values use the same operation and field layout:

```text
scene       all players
guild       guild
team        team
world       world
privateChat private
```

Private chat example:

```json
{"t":"op","op":10,"p":[[21,"privateChat"],[23,"111"]]}
```
