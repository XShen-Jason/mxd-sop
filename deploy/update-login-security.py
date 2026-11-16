#!/usr/bin/env python3
"""Update SOP + auto + their Nginx snippets to one pinned commit; preserve SSH/player."""
import argparse
from contextlib import closing
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import time
import uuid

from auto_security_release import AUTO_BINARY, AUTO_DATABASE, backup_auto, build_auto, install_binary, preflight_auto

spec = importlib.util.spec_from_file_location("sop_release", Path(__file__).with_name("update-sop-security.py"))
sop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sop)
BACKUP_ROOT = Path("/var/backups/mxd-sop")


def backup_commit(backup, name):
    """Read only a release SHA from an existing, non-link backup metadata file."""
    file = backup / name
    if not file.is_file() or file.is_symlink():
        raise RuntimeError(f"Missing regular backup metadata: {name}")
    value = file.read_text().strip()
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise RuntimeError(f"Invalid backup commit: {name}")
    return value


def verify_installed_configs(resume_backup=None):
    """Accept current Git configs, or the explicitly selected rollback baseline.

    A failed build can advance Git before runtime/config switching. A resume must
    match that backup's target HEAD, its exact saved configs and their Git source.
    This is read-only validation: never reset Git, restore data or ignore drift.
    """
    head = sop.git("rev-parse", "HEAD").decode().strip()
    reference = head
    if resume_backup is not None:
        resume_backup = Path(resume_backup)
        if (resume_backup.resolve() != resume_backup or resume_backup.parent != BACKUP_ROOT or
                not resume_backup.name.startswith("security-release-") or not resume_backup.is_dir()):
            raise RuntimeError("Resume requires an exact regular security-release backup directory")
        if backup_commit(resume_backup, "target-head") != head:
            raise RuntimeError("Resume backup target does not match current Git HEAD")
        # Old backups predate the separate config baseline; subsequent retries
        # preserve it independently of the Git source that has already advanced.
        name = "nginx-source-head" if (resume_backup / "nginx-source-head").exists() else "before-head"
        reference = backup_commit(resume_backup, name)
        sop.git("merge-base", "--is-ancestor", reference, head)
    for name, destination in sop.CONFIGS.items():
        installed = destination.read_bytes().replace(b"\r\n", b"\n")
        expected = sop.git("show", f"{reference}:deploy/security/{name}").replace(b"\r\n", b"\n")
        if installed != expected:
            raise RuntimeError(f"Installed config differs from verified Git baseline: {name}")
        if resume_backup is not None:
            saved = resume_backup / name
            if not saved.is_file() or saved.is_symlink() or saved.read_bytes().replace(b"\r\n", b"\n") != installed:
                raise RuntimeError(f"Installed config differs from the selected backup: {name}")
    if resume_backup is not None:
        print(f"RESUME_CONFIG_BASELINE_OK; {reference}; {resume_backup}", flush=True)
    return reference


def check_public_ipv4(url):
    """Validate the allowed IPv4 path with normal TLS verification, never fallback to IPv6."""
    output = sop.run("curl", "--ipv4", "--silent", "--show-error", "--max-time", "20",
                     "--user-agent", "mxd-sop-release-check/1.0", "--header", "Accept: application/json",
                     "--write-out", "\n%{http_code}\n%{content_type}", url, capture=True)
    body, status, content_type = output.rsplit(b"\n", 2)
    try:
        health = json.loads(body)
    except ValueError:
        health = None
    if status != b"200" or not isinstance(health, dict) or health.get("status") != "ok":
        metadata = {"url": url, "status": status.decode(), "content_type": content_type.decode()}
        raise RuntimeError("PUBLIC_IPV4_HEALTH_FAILED; local release remains installed; " + json.dumps(metadata))
    print(f"PUBLIC_IPV4_HEALTH_OK; {url}", flush=True)


def wait_auto():
    for _ in range(20):
        try:
            status, body = sop.request("http://127.0.0.1:26909/api/v1/healthz")
            if status == 200 and body.get("status") == "ok":
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError("Auto did not become healthy")


def probe_service(service):
    """Use fresh reserved benchmark addresses; no real credentials or game actions.

    Permanent 21/restart behavior is covered by isolated SQLite regression tests.
    Here five real failures must persist, and IPv6 must fail before authentication.
    """
    is_sop = service == "sop"
    base = "http://127.0.0.1:" + ("26902" if is_sop else "26909")
    login = "/api/v1/auth/login" if is_sop else "/api/v1/operator/login"
    health = "/health" if is_sop else "/api/v1/healthz"
    database = Path("/var/lib/mxd-sop/ops.sqlite") if is_sop else AUTO_DATABASE
    table = "auth_ip_failures" if is_sop else "operator_ip_failures"
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as connection:
        for _ in range(100):
            number = secrets.randbelow(131072)
            ip = f"198.{18 + number // 65536}.{number // 256 % 256}.{number % 256}"
            if not connection.execute(f"SELECT 1 FROM {table} WHERE ip = ?", (ip,)).fetchone():
                break
        else:
            raise RuntimeError("Could not reserve an unused test address")
        rate_ip = "192.0.2.253"  # Malformed requests never add a persistent row.
        rates = [sop.request(base + login, {"releaseProbe": True}, rate_ip) for _ in range(11)]
        if [code for code, _ in rates] != [400] * 10 + [429]:
            raise RuntimeError(f"{service}: expected ten requests per five minutes")
        rate_error = rates[-1][1]["error"] if is_sop else rates[-1][1]
        if not 290 <= rate_error.get("retryAfterSeconds", 0) <= 300:
            raise RuntimeError(f"{service}: incorrect request-window retry interval")
        payload = {"username": "release-probe-" + uuid.uuid4().hex, "password": "invalid-probe"}
        failures = [sop.request(base + login, payload, ip) for _ in range(5)]
        if [code for code, _ in failures] != [401] * 4 + [429]:
            raise RuntimeError(f"{service}: fifth credential failure did not lock")
        error = failures[-1][1]["error"] if is_sop else failures[-1][1]
        if not 1190 <= error.get("retryAfterSeconds", 0) <= 1200:
            raise RuntimeError(f"{service}: incorrect lock duration")
        row = connection.execute(f"SELECT failures FROM {table} WHERE ip = ?", (ip,)).fetchone()
        if row != (5,):
            raise RuntimeError(f"{service}: credential failures were not persisted")
    for ipv6 in ("2001:db8::123", "2001:0db8:0:0::456"):
        status, body = sop.request(base + health, probe_ip=ipv6)
        expected = "ipv6-disabled" if is_sop else "ipv6_disabled"
        actual = body.get("error", {}).get("code") if is_sop else body.get("error")
        if status != 403 or actual != expected:
            raise RuntimeError(f"{service}: IPv6 was not rejected")
    print(f"{service.upper()}_IP_POLICY_OK;10/300s;5_failures/1200s;durable_count;IPv6_403", flush=True)


def deploy(release, resume_backup=None):
    if sop.preflight(release) or sop.git("status", "--porcelain").strip():
        raise RuntimeError("Joint release requires a clean worktree; no automatic stash")
    auto_domain, go_binary = preflight_auto(sop, release)
    sop.run("curl", "--version", capture=True)
    config_reference = verify_installed_configs(resume_backup)
    player_pid = sop.service_value("mxd-player", "MainPID")
    backup = sop.make_backup([], release)
    (backup / "nginx-source-head").write_text(config_reference + "\n")
    backup_auto(backup)
    switched = config_changed = False
    try:
        sop.build_release(release, [], backup)
        artifact = build_auto(sop, go_binary, release)
        expected_auto_hash = hashlib.sha256(artifact.read_bytes()).hexdigest()
        if sop.git("status", "--porcelain").strip() or sop.git("rev-parse", "HEAD").decode().strip() != release:
            raise RuntimeError("Source changed while building; nothing switched")
        for name, destination in sop.CONFIGS.items():
            config_changed = True
            sop.run("install", "-o", "root", "-g", "root", "-m", "644", str(sop.REPO / "deploy/security" / name), str(destination))
        sop.run("nginx", "-t")
        install_binary(artifact)
        switched = True
        sop.run("systemctl", "restart", "mxd-auto-process")
        wait_auto()
        sop.run("systemctl", "restart", "mxd-sop")
        sop.wait_for_health()
        probe_service("sop")
        probe_service("auto")
        sop.run("systemctl", "reload", "nginx")
    except BaseException:
        # Restore runtime artifacts, never data: new schema is additive and old
        # binaries tolerate it. Keep newly accumulated bans and business writes.
        if config_changed:
            for name, destination in sop.CONFIGS.items():
                shutil.copy2(backup / name, destination)
            sop.run("nginx", "-t")
            sop.run("systemctl", "reload", "nginx")
        sop.restore_built_assets(backup)
        if switched:
            install_binary(backup / "auto-binary")
            sop.run("systemctl", "restart", "mxd-auto-process", "mxd-sop")
            wait_auto()
            sop.wait_for_health()
        print(f"JOINT_UPDATE_FAILED; old runtime restored; Git/backups retained at {backup}", flush=True)
        raise
    if sop.service_value("mxd-player", "MainPID") != player_pid:
        raise RuntimeError("Player PID changed unexpectedly")
    if sop.git("status", "--porcelain").strip() or sop.git("rev-parse", "HEAD").decode().strip() != release:
        raise RuntimeError("Source changed during deployment")
    hashes = {}
    if hashlib.sha256(AUTO_BINARY.read_bytes()).hexdigest() != expected_auto_hash:
        raise RuntimeError("Installed auto binary differs from the staged release")
    for name, destination in sop.CONFIGS.items():
        if destination.read_bytes() != (sop.REPO / "deploy/security" / name).read_bytes():
            raise RuntimeError(f"Installed config mismatch: {name}")
        hashes[name] = hashlib.sha256(destination.read_bytes()).hexdigest()
    evidence = {"commit": release, "auto_sha256": hashlib.sha256(AUTO_BINARY.read_bytes()).hexdigest(),
                "nginx_sha256": hashes, "sop_pid": sop.service_value("mxd-sop", "MainPID"),
                "auto_pid": sop.service_value("mxd-auto-process", "MainPID"), "player_pid": player_pid, "ssh": "unchanged"}
    (backup / "joint-deployed.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2), flush=True)
    print("JOINT_DEPLOYED_LOCAL_OK; public verification follows; no rollback on public failure", flush=True)
    check_public_ipv4("https://mxd-sop.5202345.xyz/health")
    check_public_ipv4(f"https://{auto_domain}/api/v1/healthz")
    print("LOGIN_SECURITY_DEPLOYMENT_OK; SOP+auto+Nginx; SSH/player unchanged", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commit", help="Full pinned origin/main commit")
    parser.add_argument("--resume-backup", type=Path, help="Verify configs against a specific failed release backup; never restore its database")
    args = parser.parse_args()
    deploy(args.commit, args.resume_backup)
