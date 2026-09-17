# PCAP Chat Request Analysis - 15_29_16

Source: `PCAPdroid_09_9月_15_29_16.pcap`

## Finding

After the game entry sequence, the client sends chat messages with
`op=10`. The first parameter is `privateChat`, so the
private-chat mode is represented inside the send-message request.

No separate network request for switching the chat UI to private chat was
observed. The capture contains no `resp op=10` response. The server
continues with ordinary heartbeat/time events after each message.

## Endpoint and framing

The game protocol uses TCP `45.117.11.230:12660`.

Each application frame is:

~~~text
uint32 big-endian body_length + UTF-8 JSON body
~~~

The prefix length counts the JSON body only. The client local port is
`40710` and is ephemeral.

## Entry baseline

The same connection first performs the normal entry sequence:

| Step | Packet | Time | Event |
| --- | ---: | --- | --- |
| Login | 129 | 15:29:32.735 | `op=0` |
| Login success | 131 | 15:29:32.763 | `resp op=0 rc=0` |
| Select character | 144 | 15:29:35.295 | `op=6` |
| Select success | 147 | 15:29:35.322 | `resp op=6 rc=0` |
| Entry preflight | 151 | 15:29:35.651 | `op=7` with empty map |
| Enter map | 163 | 15:29:36.600 | `op=7` with `211000000` |
| Enter success | 165 | 15:29:36.660 | `resp op=7 rc=0` |
| Post-entry init | 216 | 15:29:36.704 | `op=8` |

## Chat request 1

- Packet: `389`
- Time: `15:29:52.572`
- JSON body length: `72` bytes
- Text: 7 repetitions of `啦`

~~~json
{"t":"op","op":10,"p":[[21,"privateChat"],[23,"啦啦啦啦啦啦啦"]]}
~~~

Full framed bytes, hexadecimal:

~~~text
000000487b2274223a226f70222c226f70223a31302c2270223a5b5b32312c227072697661746543686174225d2c5b32332c22e595a6e595a6e595a6e595a6e595a6e595a6e595a6225d5d7d
~~~

## Chat request 2

- Packet: `494`
- Time: `15:30:02.313`
- JSON body length: `75` bytes
- Text: 8 repetitions of `啦`

~~~json
{"t":"op","op":10,"p":[[21,"privateChat"],[23,"啦啦啦啦啦啦啦啦"]]}
~~~

Full framed bytes, hexadecimal:

~~~text
0000004b7b2274223a226f70222c226f70223a31302c2270223a5b5b32312c227072697661746543686174225d2c5b32332c22e595a6e595a6e595a6e595a6e595a6e595a6e595a6e595a6225d5d7d
~~~

## Server-side observations

There is no `resp op=10` for either message.

- After request 1, packet 391 is `evt=18`, a heartbeat/control event.
- After request 2, packets 496 and 500 are time/heartbeat events.
- No separate private-chat mode request appears in the client stream.

The exact request frames and Base64 values are in
`pcap_chat_requests_15_29_16.json`. The captured account/token-like
values and message traffic should be kept private.

