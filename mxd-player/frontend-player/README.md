# mxd-player frontend

The frontend implements the `player-registration` capability and communicates
with `backend-player` only through the contracts in `../CONTRACTS.md`.

```text
src/
├── main.tsx                         # Vite entrypoint
├── App.tsx                          # compatibility export
├── styles.css                       # global/mobile-first tokens
└── features/player-registration/
    ├── PlayerRegistrationApp.tsx    # page state and API orchestration
    ├── api/                         # HTTP client and boundary types
    ├── components/                  # landing, teams, merge, history, modals
    ├── config/                      # player configuration and UI messages
    └── session.ts                   # browser session adapter
```

Run `npm run lint` and `npm run build` from this directory. The frontend does
not import backend implementation files or database structures.
