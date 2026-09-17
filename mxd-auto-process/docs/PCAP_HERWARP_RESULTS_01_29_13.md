# PCAP Herwarp Result Analysis - 01_29_13

Source: `datacj/PCAPdroid_13_9月_01_29_13.pcap`

## Request

Both commands use the private-chat `op=10` frame:

```json
{
  "t": "op",
  "op": 10,
  "p": [[21, "privateChat"], [23, "herwarp@<characterId>"]]
}
```

The capture has two command requests on the authenticated game connection.
There is no `resp op=10`; each result is an `evt=20` message with
`[65,"System"]` and the text in field 36.

## Observed results

| Order | Request | Request time | Result time | System message | Result |
| ---: | --- | --- | --- | --- | --- |
| 1 | `herwarp@315` | 01:29:31.156 | 01:29:31.182 | `玩家不在线无法传送。` | failure |
| 2 | `herwarp@344` | 01:29:37.869 | 01:29:37.895 | `已将玩家qwe传送到您身边。` | success |

Both request-to-result delays are approximately 26 ms. The offline response
does not echo the target ID. The success response includes the target name but
not the character ID, so correlation relies on the one-command-at-a-time
connection rule and the response order.

## Classification

- `已将玩家<name>传送到您身边。` is `success` for the outstanding herwarp
  command.
- `玩家不在线无法传送。` is `failure` for the outstanding herwarp command.
- No matching `evt=20/System` before the configured timeout remains
  `written_unconfirmed` with `delivery_status=unknown`.
- The unrelated login System events in the capture must not be assigned to a
  herwarp command.

