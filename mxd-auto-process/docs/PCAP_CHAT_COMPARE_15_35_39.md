# PCAP Chat Comparison - 15_35_39

Source: `PCAPdroid_09_9月_15_35_39.pcap`

## Conclusion

The public-chat and private-chat sends use the same operation,
`op=10`. The channel is selected by parameter field `[21]`
and the text is carried by `[23]`:

- Public chat: `[21,"scene"]`
- Private chat: `[21,"privateChat"]`

No separate network request for switching the chat UI was observed.

## Entry baseline

The main game connection is
`10.215.173.1:46396 -> 45.117.11.230:12660`. Before chat, it
successfully sends login `op=0`, character selection
`op=6`, and map entry `op=7` with map ID
`211000000`. The corresponding responses are `rc=0`.

## Request comparison

| Message | Packet | Time | Operation | Channel | Text | Body length |
| --- | ---: | --- | ---: | --- | --- | ---: |
| Public | 327 | 15:36:03.673 | `op=10` | `scene` | `asdfghjkl` | 54 |
| Private | 487 | 15:36:14.491 | `op=10` | `privateChat` | `qwertyuiop` | 61 |

Public chat request:

~~~json
{"t":"op","op":10,"p":[[21,"scene"],[23,"asdfghjkl"]]}
~~~

Private chat request:

~~~json
{"t":"op","op":10,"p":[[21,"privateChat"],[23,"qwertyuiop"]]}
~~~

Both frames use the same TCP endpoint and the same operation. The body length
difference comes from the channel and message text lengths.

## Server observations

The public message receives this event at packet 330:

~~~json
{"t":"evt","ev":1,"p":[[21,"scene"],[22,"REF"],[23,"asdfghjkl"],[19,{"$i64":"265"}]]}
~~~

No `resp op=10` or text-bearing server event for
`qwertyuiop` appears in the capture. The request was sent on the
main game connection; the small auxiliary connection contains no chat frames.

The exact framed hexadecimal and Base64 values are in
`pcap_chat_compare_15_35_39.json`. The frame prefix is a 4-byte
big-endian body length followed by UTF-8 JSON.

