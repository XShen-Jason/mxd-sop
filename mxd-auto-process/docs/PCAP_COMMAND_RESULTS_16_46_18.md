# PCAP Command Result Analysis - 16_46_18

Source: PCAPdroid_09_9月_16_46_18.pcap

## Conclusion

The capture contains four private-chat command requests on the main game
connection. All four requests reached the server, but only the first two
completed successfully.

The command request uses op=10; the server does not return resp op=10.
The result is delivered as a System event:

~~~json
{
  "t": "evt",
  "ev": 20,
  "p": [[36, "<message>"], [65, "System"]]
}
~~~

Therefore a TCP ACK or a successfully written op=10 frame is not a
successful business result. The client must read framed server messages and
classify the matching evt=20 message.

## Connection and framing

- Main connection: 10.215.173.1:53780 -> 45.117.11.230:12660
- Transport: TCP
- Application frame: uint32 big-endian body_length + UTF-8 JSON body
- The length prefix counts only the JSON body
- The capture contains no resp op=10

The local port is ephemeral and must not be treated as a stable identifier.

## Four command results

Capture timestamps below are local capture times.

| Order | Request | Request packet/time | Response packet/time | Server System message | Result |
| ---: | --- | --- | --- | --- | --- |
| 1 | drop@315@100000069@1 | 279 / 16:46:39.951 | 281 / 16:46:39.976 | 已将物品[100000069]×1发送到玩家[牛顿]的背包。 | success |
| 2 | cashid@315@1 | 399 / 16:46:50.607 | 401 / 16:46:50.631 | 已给角色[牛顿(315)]发放点券 1 | success |
| 3 | cashid@315@1 | 613 / 16:47:10.231 | 615 / 16:47:10.257 | 角色id[315]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量 | not sent |
| 4 | drop@315@100000069@1 | 777 / 16:47:24.778 | 779 / 16:47:24.804 | 目标玩家[315]不在线，无法发送物品。 | not sent |

The request-to-result delays are 25 ms, 24 ms, 26 ms and 26 ms. Each result
is the next relevant System event after its request.

## Result interpretation

### drop

Observed success form:

~~~text
已将物品[<itemCode>]×<quantity>发送到玩家[<playerName>]的背包。
~~~

Observed failure form:

~~~text
目标玩家[<characterId>]不在线，无法发送物品。
~~~

Only the success form should set sent_successfully=true. The offline form
must set it to false.

### cashid

Observed success form:

~~~text
已给角色[<playerName>(<characterId>)]发放点券 <quantity>
~~~

Observed offline form:

~~~text
角色id[<characterId>]不在线。给账号发点券(支持离线)请使用: zzdd@账号@数量
~~~

The offline cashid message is not an acknowledgement of the original
cashid command. It instructs the operator to use another command, so the
original operation is not sent and sent_successfully=false. This capture
does not contain a subsequent zzdd request or a result for it.

## Required receive-and-classify flow

1. Send one framed op=10 request.
2. Keep reading TCP data until complete application frames are available;
   one read is not guaranteed to contain one frame.
3. Ignore resp messages and unrelated events for this command.
4. Inspect only t=evt, ev=20, field 65="System", and extract field 36 as
   the server message.
5. Match a command-specific success or failure form and verify the expected
   character, item and quantity where the message contains them.
6. Mark success only on a positive success form. Mark the two observed
   offline forms as not_sent; if no terminal System event arrives before the
   configured timeout, use unknown/timeout, never success.

There is no request ID in the observed request or System event. To prevent a
System event from being assigned to the wrong command, keep at most one
business command outstanding on a connection and wait for its terminal result
before sending the next one. If concurrent sends are later required, the
protocol needs an additional correlation rule or a server-side request ID.

## Unrelated System event

Packet 38 contains:

~~~text
检测到角色已在线，已为你顶号登录。
~~~

It is part of the login flow and occurs before the four commands. It must not
be treated as a result for any drop or cashid request.

