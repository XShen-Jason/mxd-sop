# PCAP Ban Failure Result Analysis - 02_32_00

Source: `datacj/PCAPdroid_13_9月_02_32_00.pcap`

## Request

The command uses the private-chat `op=10` frame:

```json
{
  "t": "op",
  "op": 10,
  "p": [[21, "privateChat"], [23, "ban@<characterId>"]]
}
```

The capture contains one request, `ban@344`, at 02:32:08.159 on the main
connection `10.215.173.1:56278 -> 45.117.11.230:12660`. The server does not
return `resp op=10`.

## Response

Approximately 36 ms after the request, the server returns an `evt=20` event
with field 65 set to `System`. Field 36 contains:

`角色[344]不在线,无法封禁(需玩家在线时执行)。`

This is the command-specific terminal response for the outstanding ban
request. It says that the target was offline and the ban could not be applied.

## Classification

- `角色[<characterId>]不在线,无法封禁(需玩家在线时执行)。` is
  `failure` when the character ID matches the `ban@<characterId>` request.
- The failed command must not be reported as a successful ban or as a
  transport-only success.
- A non-matching ban notification is not a result for the current command.
- If no matching terminal System event arrives before the configured timeout,
  the result remains `written_unconfirmed` with `delivery_status=unknown`.

