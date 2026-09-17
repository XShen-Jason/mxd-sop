# PCAP Ban Result Analysis - 01_31_37

Source: `datacj/PCAPdroid_13_9月_01_31_37.pcap`

## Request

The command uses the same private-chat `op=10` frame as the other operator
commands:

```json
{
  "t": "op",
  "op": 10,
  "p": [[21, "privateChat"], [23, "ban@<characterId>"]]
}
```

The capture contains one request, `ban@344`, at 01:31:45.702. The server
does not return `resp op=10`.

## Response sequence

At 01:31:45.753 the server sends two events in the same TCP payload:

1. `evt=1` with field 21=`system` and a broadcast describing the violation:

   `检测出[q**](ID:**4)作弊或篡改数据等违规操作，已进行封禁处理。`

2. `evt=20` with field 65=`System` and field 36:

   `已封禁角色[qwe(344)]。`

The second event is the authoritative command result. The first event is a
system broadcast and is not a private-chat echo or a terminal acknowledgement.

## Classification

- `已封禁角色[<name>(<characterId>)]。` is `success` only when the returned
  character ID matches the `ban` request.
- The `evt=1` system broadcast must be ignored.
- No matching terminal `evt=20/System` before the configured timeout remains
  `written_unconfirmed` with `delivery_status=unknown`.
- The capture contains no negative ban response, so no failure text is
  established yet. Unknown must not be converted to success.

