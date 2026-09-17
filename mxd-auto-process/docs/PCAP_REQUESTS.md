# PCAP Request Extraction

Source: `PCAPdroid_09_9月_14_57_12.pcap`

The three target requests are carried by the clear-text TCP connection
`10.215.173.1:<ephemeral-port> -> 45.117.11.230:12660`.

## Wire format

Each application message is:

~~~text
uint32 big-endian body_length + UTF-8 JSON body
~~~

The length prefix counts the JSON body only. The TCP local ports are ephemeral
and must not be hard-coded.

## Replay order observed in the first login

1. Send `op=0` to log in.
2. Wait for `resp op=0 rc=0`.
3. Send `op=6` with the selected character ID.
4. The first capture included an observed pre-entry `op=7` with an empty map value.
5. Send the actual entry request `op=7` with map ID `211000000`.
6. Wait for `resp op=7 rc=0` and the following map initialization events.

The empty `op=7` had no matching response in the first capture. A newer
capture shows that the second successful entry skipped it, so it must be
treated as conditional or auxiliary rather than a universal prerequisite.

## Target requests

### 1. Login

- Capture time: `2026-09-09 14:57:43.301`
- Packet: `231`
- Connection: `10.215.173.1:38280 -> 45.117.11.230:12660`
- JSON body length: `72` bytes

~~~json
{"t":"op","op":0,"p":[[0,"<redacted-account>"],[1,"<redacted-token>"],[35,"1.0.2"]]}
~~~

The captured frame bytes are intentionally omitted because they contain the
same account credential material.

The server replied with `resp op=0 rc=0`, including character ID `265` and
an ephemeral server-side key (redacted).

### 2. Select character

- Capture time: `2026-09-09 14:57:49.230`
- Packet: `284`
- Connection: `10.215.173.1:38280 -> 45.117.11.230:12660`
- JSON body length: `66` bytes

~~~json
{"t":"op","op":6,"p":[[10,"265"],[81,"<redacted-opaque>"]]}
~~~

The captured frame bytes are intentionally omitted because they contain the
same role-selection opaque value.

The server replied with `resp op=6 rc=0`; its returned character data
contains `charid=265` and `mapId=211000000`.

### 3. Enter the real game

- Capture time: `2026-09-09 14:57:50.675`
- Packet: `307`
- Connection: `10.215.173.1:38280 -> 45.117.11.230:12660`
- JSON body length: `40` bytes

~~~json
{"t":"op","op":7,"p":[[16,"211000000"]]}
~~~

Full framed bytes, hexadecimal:

~~~text
000000287b2274223a226f70222c226f70223a372c2270223a5b5b31362c22323131303030303030225d5d7d
~~~

The server replied with:

~~~json
{"t":"resp","op":7,"rc":0,"p":[[34,{"$i32":1}]]}
~~~

## Observed pre-entry request

This request was sent at `2026-09-09 14:57:49.703` in packet `297`, before
the successful map entry request:

~~~json
{"t":"op","op":7,"p":[[16,""]]}
~~~

Its full frame is:

~~~text
0000001f7b2274223a226f70222c226f70223a372c2270223a5b5b31362c22225d5d7d
~~~

## Re-login evidence

After leaving the game, the same `op=0` login body appeared again on a new
TCP connection at packets `508` and `565`. The new local port was
`55968`; the server endpoint remained `45.117.11.230:12660`. No new
`op=6` or map-entry `op=7` was sent during those two later login attempts.

The values in this file are copied from the capture. The account/token-like
value in `op=0` and the opaque value in `op=6` may be session-specific or
secret; keep this artifact private and do not assume they remain valid.
