#!/usr/bin/env python3
"""Deploy one pinned SOP release on HK-MXD; never modify SSH, auto or player.

Run as root from an archive of the already-fetched GitHub commit. Source edits
must match the published release or a known prior patch. Backups and evidence
stay outside business databases. Build failure does not restart the service.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import uuid

from sop_release_checks import verify_local_changes, verify_probe_responses

REPO = Path("/opt/mxd-sop")
CONFIGS = {
    "mxd-login-guard.conf": Path("/etc/nginx/conf.d/mxd-login-guard.conf"),
    "mxd-login-server.conf": Path("/etc/nginx/snippets/mxd-login-server.conf"),
    "mxd-cloudflare-realip.conf": Path("/etc/nginx/snippets/mxd-cloudflare-realip.conf"),
}


def run(*args, capture=False, user=False):
    command = list(args)
    if user:
        command = ["runuser", "-u", "mxd-sop", "--", *command]
    return subprocess.run(command, cwd=REPO, check=True, stdout=subprocess.PIPE if capture else None).stdout


def git(*args):
    return run("git", "-c", "core.fileMode=false", *args, capture=True, user=True)


def service_value(service, key):
    return run("systemctl", "show", service, f"--property={key}", "--value", capture=True).decode().strip()


def preflight(release):
    if os.geteuid() != 0 or REPO.resolve() != REPO or not re.fullmatch(r"[a-f0-9]{40}", release):
        raise RuntimeError("Run as root for /opt/mxd-sop with one full commit SHA")
    if git("rev-parse", "--show-toplevel").decode().strip() != str(REPO):
        raise RuntimeError("Unexpected Git repository")
    if git("branch", "--show-current").decode().strip() != "main":
        raise RuntimeError("Expected the main branch")
    if git("rev-parse", "origin/main").decode().strip() != release:
        raise RuntimeError("The pinned release must equal the fetched origin/main")
    git("merge-base", "--is-ancestor", "HEAD", release)
    if service_value("mxd-sop", "WorkingDirectory") != str(REPO):
        raise RuntimeError("SOP service working directory differs from the documented deployment")
    if "/opt/mxd-sop/backend/dist/src/server.js" not in service_value("mxd-sop", "ExecStart"):
        raise RuntimeError("SOP service is not running the expected compiled entry point")
    for service in ("mxd-sop", "nginx", "mxd-auto-process", "mxd-player"):
        run("systemctl", "is-active", "--quiet", service)
    run("nginx", "-t")
    for destination in CONFIGS.values():
        if not destination.is_file() or destination.is_symlink():
            raise RuntimeError(f"Expected the already-installed security snippet: {destination}")
    for name in ("backend/dist", "frontend/dist"):
        target = REPO / name
        if not target.is_dir() or target.is_symlink() or target.resolve() != target:
            raise RuntimeError(f"Expected a regular generated-output directory: {target}")
    return verify_local_changes(REPO, release, git)


def make_backup(changes, release):
    parent = Path("/var/backups/mxd-sop")
    parent.mkdir(parents=True, exist_ok=True)
    backup = Path(tempfile.mkdtemp(prefix="security-release-", dir=parent))
    os.chmod(backup, 0o700)
    (backup / "source.patch").write_bytes(git("diff", "--binary"))
    (backup / "before-head").write_bytes(git("rev-parse", "HEAD"))
    (backup / "target-head").write_text(release + "\n")
    with tarfile.open(backup / "source-edits.tar.gz", "w:gz") as archive:
        for name in changes:
            archive.add(REPO / name, arcname=name)
    with tarfile.open(backup / "built-assets.tar.gz", "w:gz") as archive:
        for name in ("backend/dist", "frontend/dist"):
            if not (REPO / name).is_dir():
                raise RuntimeError(f"Missing current build output: {name}")
            archive.add(REPO / name, arcname=name)
    for name, destination in CONFIGS.items():
        shutil.copy2(destination, backup / name)
    database = Path("/var/lib/mxd-sop/ops.sqlite")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as source:
        with sqlite3.connect(backup / "ops.sqlite") as target:
            source.backup(target)
    catalog = database.parent / "item-catalog.csv"
    if catalog.exists():
        shutil.copy2(catalog, backup / catalog.name)
    print(f"BACKUP={backup}", flush=True)
    return backup


def build_release(release, changes, backup):
    if changes:
        # Stash only the verified source paths, never the retained runtime token.
        git("stash", "push", "--include-untracked", "--message", f"HK-MXD pre-release {release[:12]}", "--", *changes)
        (backup / "stash-id").write_bytes(git("rev-parse", "refs/stash"))
    git("merge", "--ff-only", release)
    if git("rev-parse", "HEAD").decode().strip() != release:
        raise RuntimeError("Git did not reach the pinned release")
    # Explicit flags override production omit/ignore-scripts settings, without
    # deleting the operator's npm configuration or changing dependency locks.
    run("npm", "ci", "--include=dev", "--ignore-scripts=false", "--package-lock=false", user=True)
    for command in ("test", "lint", "build"):
        run("npm", "run", command, user=True)
    run("python3", "deploy/tests/cloudflare-realip.test.py")
    if git("status", "--porcelain=v1", "--untracked-files=all").strip():
        raise RuntimeError("Build modified source-controlled files or created unignored files")
    if git("rev-parse", "HEAD").decode().strip() != release:
        raise RuntimeError("Repository commit changed during the build")


def request(url, body=None, probe_ip=None):
    """Return HTTP status and a JSON object, retaining metadata on invalid bodies.

    HTTP errors may carry valid login errors. A proxy/challenge response may be
    HTML or empty; never treat that as health success or print its response body.
    """
    # Identify this probe explicitly: the public edge returned 403 for the
    # generic Python-urllib agent during release verification.
    headers = {"Accept": "application/json", "User-Agent": "mxd-sop-release-check/1.0"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if probe_ip:
        headers["X-Forwarded-For"] = probe_ip
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        metadata = {"status": response.status, "content_type": response.headers.get("Content-Type"),
                    "server": response.headers.get("Server"), "cf_ray": response.headers.get("CF-Ray"),
                    "cf_mitigated": response.headers.get("CF-Mitigated")}
        try:
            payload = json.load(response)
        except ValueError:
            raise ValueError("Expected JSON object; HTTP metadata=" + json.dumps(metadata)) from None
        if not isinstance(payload, dict):
            raise ValueError("Expected JSON object; HTTP metadata=" + json.dumps(metadata))
        return response.status, payload


class PublicHealthError(RuntimeError):
    """Public verification failed; it does not imply rollback of a local release."""


def check_public_health():
    """Read-only public check, usable separately without Git, root or restarts."""
    try:
        status, health = request("https://mxd-sop.5202345.xyz/health")
    except (OSError, ValueError) as error:
        raise PublicHealthError(f"PUBLIC_HEALTH_CHECK_FAILED; {error}") from None
    if status != 200 or health.get("status") != "ok":
        raise PublicHealthError(f"PUBLIC_HEALTH_CHECK_FAILED; HTTP {status}; expected status=ok")
    print("PUBLIC_HEALTH_OK; HTTP 200; status=ok", flush=True)


def wait_for_health():
    for _ in range(15):
        try:
            status, payload = request("http://127.0.0.1:26902/health")
            if status == 200 and payload.get("status") == "ok":
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError("SOP did not become healthy after restart")


def probe_limits():
    base = "http://127.0.0.1:26902"
    # Reserved documentation addresses isolate probes from real users. Unknown
    # fields exercise the request quota without accumulating credential failures.
    rates = [request(base + ("/api/v1/login" if i % 2 else "/api/v1/auth/login"),
                     {"releaseProbe": True}, "192.0.2.253") for i in range(11)]
    probe_user = "release-probe-" + uuid.uuid4().hex
    locks = [request(base + "/api/v1/auth/login", {"username": probe_user, "password": "invalid-probe"},
                     "192.0.2.254") for _ in range(5)]
    verify_probe_responses(rates, locks)
    print("LOGIN_LIMIT_OK=10_requests_per_300_seconds;5_failures_lock_1200_seconds", flush=True)


def restore_built_assets(backup):
    # These exact generated paths are backed up above, are not symlinks, and
    # contain no application data. Never restore a database during rollback.
    with tarfile.open(backup / "built-assets.tar.gz") as archive:
        # Debian 12's original Python lacks tarfile's newer extraction filter.
        # Validate our own backup members explicitly before extracting anything.
        for member in archive.getmembers():
            destination = (REPO / member.name).resolve()
            allowed = any(destination == REPO / name or REPO / name in destination.parents
                          for name in ("backend/dist", "frontend/dist"))
            if not allowed or not (member.isfile() or member.isdir()):
                raise RuntimeError(f"Unsafe generated-output archive member: {member.name}")
        for name in ("backend/dist", "frontend/dist"):
            target = REPO / name
            if target.is_symlink() or target.resolve() != target:
                raise RuntimeError(f"Unsafe generated-output rollback path: {target}")
            if target.exists():
                shutil.rmtree(target)
        options = {"filter": "data"} if hasattr(tarfile, "data_filter") else {}
        archive.extractall(REPO, **options)
    run("chown", "-R", "mxd-sop:mxd-sop", "backend/dist", "frontend/dist")


def deploy(release):
    changes = preflight(release)
    preserved = {name: service_value(name, "MainPID") for name in ("mxd-auto-process", "mxd-player")}
    backup = make_backup(changes, release)
    config_changed = restarted = False
    try:
        build_release(release, changes, backup)
        for name, destination in CONFIGS.items():
            config_changed = True
            run("install", "-o", "root", "-g", "root", "-m", "644", str(REPO / "deploy/security" / name), str(destination))
        run("nginx", "-t")
        restarted = True
        run("systemctl", "restart", "mxd-sop")
        wait_for_health()
        probe_limits()
        run("systemctl", "reload", "nginx")
    except BaseException:
        if config_changed:
            for name, destination in CONFIGS.items():
                shutil.copy2(backup / name, destination)
            run("nginx", "-t")
            run("systemctl", "reload", "nginx")
        restore_built_assets(backup)
        if restarted:
            run("systemctl", "restart", "mxd-sop")
            wait_for_health()
        print(f"UPDATE_FAILED; old build restored; Git/stash and backups retained at {backup}", flush=True)
        raise
    for name, pid in preserved.items():
        if service_value(name, "MainPID") != pid:
            raise RuntimeError(f"Unexpected process change during deployment: {name}")
    if git("rev-parse", "HEAD").decode().strip() != release or git("status", "--porcelain").strip():
        raise RuntimeError("Repository changed during deployment; do not claim release consistency")
    hashes = {}
    for name, destination in CONFIGS.items():
        expected = (REPO / "deploy/security" / name).read_bytes()
        if destination.read_bytes() != expected:
            raise RuntimeError(f"Installed snippet differs from release: {name}")
        hashes[name] = hashlib.sha256(expected).hexdigest()
    evidence = {"commit": release, "nginx_sha256": hashes, "sop_pid": service_value("mxd-sop", "MainPID"),
                "unchanged_pids": preserved, "ssh": "unchanged", "scope": "SOP and Nginx; auto/player binaries unchanged"}
    (backup / "deployed.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2), flush=True)
    # Public verification is outside rollback: local health, login probes and
    # deployed.json already confirm the release. Recheck without redeploying.
    print("SOP_DEPLOYED_LOCAL_OK; public check follows; failure will not roll back; "
          "recheck with --check-public-health", flush=True)
    check_public_health()
    print("SOP_DEPLOYMENT_OK; public health OK; SSH/auto/player untouched", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("commit", nargs="?", help="Full commit SHA already fetched as origin/main")
    parser.add_argument("--check-public-health", action="store_true", help="Only check public health; no deployment")
    args = parser.parse_args(argv)
    if bool(args.commit) == args.check_public_health:
        parser.error("Provide a commit OR --check-public-health")
    try:
        if args.check_public_health:
            check_public_health()
        else:
            deploy(args.commit)
    except PublicHealthError as error:
        parser.exit(2, str(error) + "\n")


if __name__ == "__main__":
    main()
