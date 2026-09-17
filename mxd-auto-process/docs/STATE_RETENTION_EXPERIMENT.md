# State Retention Experiment

## Scope

This experiment checks client-side protocol-state dependence using a local
synthetic framed TCP client. It does not claim a server vulnerability and does
not send probes to the captured endpoint.

## Variants

- `session`: retain only the verified login key and role opaque value in the
  session's memory for later operations. Neither is persisted or exposed.
- `minimal`: discard login-derived key and role state immediately. Selection
  requires the operator to provide the role opaque value at request time.

## Result

The local fixture completed login, selection, map entry, initialization, and
private-chat frame writing in `minimal` mode when the synthetic runtime opaque
value was supplied. The fixture also confirms that the login key is not copied
into select field 81. This demonstrates that the observed client request
sequence does not require the login key to be retained; it is not evidence that
the remote server accepts missing authentication state or has an authorization
bypass.

Run the bounded local check with:

```powershell
go test -run TestSessionMinimalRetentionCanUseExplicitRuntimeOpaque ./internal/gamesession
```

