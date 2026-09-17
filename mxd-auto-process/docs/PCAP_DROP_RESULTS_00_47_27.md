# PCAP Drop Results - 00_47_27

Source: `datacj/PCAPdroid_12_9月_00_47_27.pcap`

## Conclusion

The capture contains three private-chat `drop` commands. Each request is an
`op=10` frame with field `21=privateChat` and the command in field `23`.
The first target is offline. The next two requests target the operator's own
role and are accepted by the server.

| Order | Field 23 command | Server terminal message | Result |
| ---: | --- | --- | --- |
| 1 | `drop@315@100000069@1` | `目标玩家[315]不在线，无法发送物品。` | failure |
| 2 | `drop@265@100000069@1` | `已将物品[100000069]×1发送到玩家[REF]的背包。` | success |
| 3 | `drop@265@100000068@1` | `已将物品[100000068]×1发送到玩家[REF]的背包。` | success |

The success responses are followed by `GM赠送您物品[...]×1。`. This is the
self-delivery notification/echo for the same command, not a second send and
not a separate success counter increment. A matching chat echo, if present,
must also be ignored for a `drop` command until the command-result System
message is received.

## Classification

The backend waits for `evt=20` with field `65=System` and matches field `36`:

- `已将物品[<item>]×<quantity>发送到玩家[<name>]的背包。` is `success` when
  `<item>` and `<quantity>` match the command.
- `目标玩家[<target>]不在线，无法发送物品。` is `failure` when `<target>`
  matches the command.
- An echo, unrelated System event, or timeout is never treated as success;
  it produces `unknown` if no terminal command result is observed.

The HTTP response exposes this result as `delivery_status`. The session
snapshot counts written chat frames in `chat_success_count`,
`chat_failure_count`, and `chat_unknown_count`.
