# PCAP CashID Result Analysis - 01_21_00

Source: `datacj/PCAPdroid_13_9月_01_21_00.pcap`

## Conclusion

The capture contains three private-chat `cashid` commands on the main game
connection. The request is the same framed `op=10` used by `drop`, but the
business result is different:

```json
{
  "t": "op",
  "op": 10,
  "p": [[21, "privateChat"], [23, "cashid@<characterId>@<quantity>"]]
}
```

The server does not return `resp op=10`. An online target produces an
intermediate `evt=63` `WalletBalance` update, followed by two `evt=20/System`
messages. The first System message is the command result; the second is the
recipient's notification. An offline target produces only the System failure
message observed below.

## Observed results

| Order | Request | Server events | Result |
| ---: | --- | --- | --- |
| 1 | `cashid@265@1` | `evt=63 WalletBalance` balance `8465`; `evt=20` `已给角色[REF(265)]发放点券 1`; `evt=20` `GM[REF]给你发放点券: 1` | success |
| 2 | `cashid@315@10` | `evt=20` `角色id[315]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量` | failure / not issued |
| 3 | `cashid@265@10` | `evt=63 WalletBalance` balance `8475`; `evt=20` `已给角色[REF(265)]发放点券 10`; `evt=20` `GM[REF]给你发放点券: 10` | success |

The observed wallet balance moves from `8465` to `8475` after the two
successful commands. The balance event is state synchronization, not the
cashid acknowledgement and not a replacement for matching the requested
character and quantity.

## Classification

The parser must inspect `evt=20` messages with field `65=System` and match
field `36` against the command that is currently in flight:

- `已给角色[<name>(<characterId>)]发放点券 <quantity>` is `success` only when
  both `<characterId>` and `<quantity>` match the request.
- `角色id[<characterId>]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量`
  is `failure` when `<characterId>` matches. It says to use `zzdd`; it is not
  evidence that the original `cashid` was issued.
- `GM[<name>]给你发放点券: <quantity>` is a self-notification and must be
  ignored until the command-result message has been observed.
- `evt=63` with field `65=WalletBalance` is an intermediate event and must be
  ignored for command completion.
- No matching terminal System message before the response timeout remains
  `written_unconfirmed` with `delivery_status=unknown`.

The protocol has no request ID. The session therefore keeps one business
command outstanding on a connection and matches the response fields to that
command. A stale cashid notification must not answer a later ordinary chat.
