# PCAP Request Analysis - 15_12_22

Source: `PCAPdroid_09_9月_15_12_22.pcap`

## Conclusion

This capture contains two successful game entries. The common network-level
sequence is:

1. Send `op=0` login.
2. Wait for `resp op=0 rc=0`.
3. Send `op=6` for the selected character.
4. Wait for `resp op=6 rc=0`.
5. Send `op=7` with map ID `211000000`.
6. Wait for `resp op=7 rc=0`.

`op=8` is sent after the successful `op=7` response,
so it is post-entry initialization.

The empty-map request `{"t":"op","op":7,"p":[[16,""]]}` appeared only before
the first entry. The second entry skipped it and still succeeded. It is
conditional or auxiliary, not a universal prerequisite.

## Endpoint and framing

The game protocol uses TCP `45.117.11.230:12660`. The client local
ports `53232` and `42800` are ephemeral.

Each application frame is:

~~~text
uint32 big-endian body_length + UTF-8 JSON body
~~~

The length prefix counts the JSON body only. `op=19` and `ping`
heartbeats appear throughout the capture to keep the connection alive.

## First successful entry

Connection: `10.215.173.1:53232 -> 45.117.11.230:12660`

| Step | Packet | Time | Network event |
| --- | ---: | --- | --- |
| Login | 86 | 15:12:50.447 | `op=0` |
| Login success | 89 | 15:12:50.472 | `resp op=0 rc=0` |
| Select character | 144 | 15:12:56.361 | `op=6` |
| Select success | 147 | 15:12:56.405 | `resp op=6 rc=0` |
| Conditional preflight | 154 | 15:12:56.760 | `op=7` with empty map |
| Enter map | 164 | 15:12:57.695 | `op=7` with `211000000` |
| Enter success | 166 | 15:12:57.717 | `resp op=7 rc=0` |
| Post-entry init | 205 | 15:12:57.811 | `op=8` |

Packet 166 is followed by `MapPlayerList`, `Refresh` and
`211000000:ch1` events, confirming real map entry. The empty
preflight has no matching response.

## Second successful entry

Connection: `10.215.173.1:42800 -> 45.117.11.230:12660`

| Step | Packet | Time | Network event |
| --- | ---: | --- | --- |
| Login transition 1 | 281 | 15:13:06.182 | `op=0` |
| Login success | 284 | 15:13:06.234 | `resp op=0 rc=0` |
| Login transition 2 | 343 | 15:13:18.363 | `op=0` |
| Login success | 345 | 15:13:18.525 | `resp op=0 rc=0` |
| Select character | 365 | 15:13:21.747 | `op=6` |
| Select success | 367 | 15:13:21.774 | `resp op=6 rc=0` |
| Enter map | 380 | 15:13:22.959 | `op=7` with `211000000` |
| Enter success | 382 | 15:13:23.015 | `resp op=7 rc=0` |
| Post-entry init | 410 | 15:13:23.031 | `op=8` |

There is no empty `op=7` or other business request between the
successful `op=6` response and the map entry request in this
second entry.

## Network-level counts

- `op=0` login: 3 times, packets 86, 281, 343.
- `op=6` select character: 2 times, packets 144, 365.
- `op=7` with map ID: 2 times, packets 164, 380.
- Empty `op=7`: 1 time, packet 154.
- `op=8` post-entry initialization: 2 times, packets 205, 410.

The UI sequence described by the user includes three role-page visits, but
only two network-level `op=6` requests are visible. The first
post-exit `op=0` response and the next `op=0` request
have no intervening business request in this capture.

