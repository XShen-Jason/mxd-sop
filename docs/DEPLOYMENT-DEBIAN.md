# Debian Deployment

For the current internal workload, deploy one backend process and one SQLite
database file. The application does not impose a fixed user-count limit. Do
not install PostgreSQL or Redis yet; move to PostgreSQL when measured write
concurrency, multiple application replicas, or centralized reporting requires
it.

## Initial setup

1. Install Node.js 22 LTS, Nginx, and SQLite tooling.
2. Create a dedicated account and directories:

```bash
sudo useradd --system --home /opt/ops-desk --shell /usr/sbin/nologin opsdesk
sudo install -d -o opsdesk -g opsdesk /opt/ops-desk /var/lib/ops-desk /etc/ops-desk
```

3. Copy the repository to `/opt/ops-desk`, then run `npm ci` and `npm run build`.
4. Copy `.env.example` to `/etc/ops-desk/ops-desk.env`, set a unique initial
   password, and restrict it:

```bash
sudo chmod 600 /etc/ops-desk/ops-desk.env
```

5. Install `deploy/ops-desk.service` into `/etc/systemd/system/`, replace the
   Nginx `server_name` and certificate paths in `deploy/nginx.conf`, then enable
   both services.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ops-desk
sudo nginx -t && sudo systemctl reload nginx
```

On the first successful start, the application creates exactly one
`super_admin` from `INITIAL_ADMIN_*`. Remove `INITIAL_ADMIN_PASSWORD` from the
environment file after that first start; the account remains in SQLite.

## Backups and upgrades

Run `deploy/backup-sqlite.sh` daily as root or the `opsdesk` user. Keep at least
30 days of encrypted, off-host backups. Stop the service before upgrading Node
or native dependencies, run `npm ci --omit=dev`, build, then restart and check
`/health`.

The application uses WAL mode and transactional writes. PostgreSQL becomes
appropriate only when you need multiple application replicas, high write
concurrency, or centralized operational reporting.

## Security baseline

- Keep Fastify bound to `127.0.0.1`; expose only Nginx on 443.
- Use an internal CA or ACME certificate and keep `COOKIE_SECURE=true`.
- Do not enable `CORS_ORIGIN` unless a separate trusted frontend origin is
  required.
- Accounts are created only by an authenticated manager or super admin; public
  registration is not implemented.
