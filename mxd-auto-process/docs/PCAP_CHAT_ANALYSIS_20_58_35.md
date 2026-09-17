# PCAP Chat Analysis - 20_58_35

Source: `datacj/PCAPdroid_11_9月_20_58_35.pcap`

## Wire mapping

The five messages use the same framed TCP operation:

```text
uint32 big-endian JSON body length + UTF-8 JSON body
```

The request is `op=10`. Field `21` selects the chat channel and field `23`
contains the message text.

| Input | UI meaning | Field 21 | Request body |
| ---: | --- | --- | --- |
| `1` | 所有人 | `scene` | `{"t":"op","op":10,"p":[[21,"scene"],[23,"1"]]}` |
| `2` | 公会 | `guild` | `{"t":"op","op":10,"p":[[21,"guild"],[23,"2"]]}` |
| `3` | 队伍 | `team` | `{"t":"op","op":10,"p":[[21,"team"],[23,"3"]]}` |
| `4` | 世界 | `world` | `{"t":"op","op":10,"p":[[21,"world"],[23,"4"]]}` |
| `5` | 私聊 | `privateChat` | `{"t":"op","op":10,"p":[[21,"privateChat"],[23,"5"]]}` |

## Observed returns

The server did not return `resp op=10` in this capture.

- `1` (`scene`) returned `evt=1` with `[21,"scene"]`, `[22,"REF"]`,
  `[23,"1"]`, and `[19,{"$i64":"265"}]`. This is a chat echo.
- `2` (`guild`) returned `evt=20` with
  `[36,"您还没有加入公会！"]` and `[65,"System"]`.
- `3` (`team`) returned `evt=1` with `[21,"team"]`, `[22,"REF"]`,
  `[23,"3"]`, and `[19,{"$i64":"265"}]`. This is a chat echo.
- `4` (`world`) returned `evt=1` with `[21,"world"]`, `[22,"REF"]`,
  `[23,"4"]`, and `[19,{"$i64":"265"}]`. This is a chat echo.
- `5` (`privateChat`) had no matching chat response before the capture ended.
  It is only a written, unconfirmed result.

Heartbeat, time, and player synchronization events also appear between these
frames. They are unrelated to the corresponding chat result. Because chat
events have no request ID, the client keeps one chat operation in flight and
waits within the configured response timeout before returning
`written_unconfirmed`.
