# Keyless Protocol Experiment

This is an opt-in diagnostic for an authorized configured server. It is not a
vulnerability finding by itself.

## What the captured flow shows

- Login `op=0` returns a `server_key` in the response, but the observed private
  chat `op=10` has no server-key field.
- Character selection `op=6` uses character ID field `10` and role opaque field
  `81`.
- Private chat `op=10` uses field `21=privateChat` and field `23=message`.

## UI

Open the operator page on loopback. After login and map entry:

1. Click `Show keys` to inspect the in-memory `server_key` and selected role
   opaque.
2. Click `Chat without stored key` to clear the local login key and send one
   private-chat frame on the already authenticated TCP connection.
3. To test a fresh connection with no login context, set
   `allow_keyless_probe` to `true` for the authorized server, restart the
   backend, and click `Fresh connection probe`.

The same-connection action also observes the bounded server-result window and
may return `server_response_received` with the server event text. The fresh
connection probe remains `written_unconfirmed`; packet write success does not
prove server acceptance.

## HTTP examples

```powershell
Invoke-RestMethod http://127.0.0.1:8080/api/v1/sessions/<session-id>/diagnostics/protocol-state

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8080/api/v1/sessions/<session-id>/diagnostics/chat-without-stored-key `
  -ContentType application/json -Body '{"message":"111"}'

Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8080/api/v1/servers/<server-id>/diagnostics/chat-without-login `
  -ContentType application/json -Body '{"message":"111"}'
```

The last request is rejected with `keyless_probe_disabled` unless the server
definition explicitly enables it. Keep the operator API bound to loopback while
raw diagnostic values are enabled.
