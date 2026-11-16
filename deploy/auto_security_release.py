"""Auto-specific staging/backup helpers for the explicitly requested joint release."""
import os
from contextlib import closing
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile

AUTO_BINARY = Path("/opt/mxd-auto-process/bin/mxd-auto-process")
AUTO_DATABASE = Path("/var/lib/mxd-auto-process/auto.sqlite")
AUTO_KEY = Path("/var/lib/mxd-auto-process/auto-credentials.key")
AUTO_ENV = Path("/etc/mxd-auto-process/mxd-auto-process.env")
AUTO_GO = Path("/opt/mxd-auto-process/toolchain/bin/go")
AUTO_SOURCE = "mxd-auto-process/backend-auto-process"
AUTO_FRONTEND = "mxd-auto-process/frontend-auto-process"


def preflight_auto(sop):
    """Require the documented existing installation; never bootstrap or reset it."""
    if str(AUTO_BINARY) not in sop.service_value("mxd-auto-process", "ExecStart"):
        raise RuntimeError("Unexpected auto service entry point")
    for file in (AUTO_BINARY, AUTO_DATABASE, AUTO_KEY, AUTO_ENV, AUTO_GO):
        if not file.is_file() or file.is_symlink():
            raise RuntimeError(f"Expected an existing regular deployment file: {file}")
    values = {}
    for line in AUTO_ENV.read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key in ("AUTO_DATABASE_PATH", "AUTO_CREDENTIAL_KEY_PATH", "AUTO_DOMAIN"):
            values[key] = value.strip().strip('"').strip("'")
    if values.get("AUTO_DATABASE_PATH") != str(AUTO_DATABASE) or values.get("AUTO_CREDENTIAL_KEY_PATH") != str(AUTO_KEY):
        raise RuntimeError("Auto data paths differ from the documented deployment; no files changed")
    domain = values.get("AUTO_DOMAIN", "")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}", domain):
        raise RuntimeError("AUTO_DOMAIN is missing or invalid")
    sop.run(str(AUTO_GO), "version")
    return domain


def backup_auto(backup):
    # Root-only parent already created by SOP backup. Keep secrets on this host.
    shutil.copy2(AUTO_BINARY, backup / "auto-binary")
    shutil.copy2(AUTO_ENV, backup / "auto.env")
    shutil.copy2(AUTO_KEY, backup / "auto-credentials.key")
    with closing(sqlite3.connect(AUTO_DATABASE.as_uri() + "?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(backup / "auto.sqlite")) as destination:
            source.backup(destination)


def build_auto(sop):
    """Compile into a separate directory; a running executable is never overwritten."""
    stage = Path(tempfile.mkdtemp(prefix="mxd-auto-security-", dir="/var/tmp"))
    sop.run("chown", "mxd-sop:mxd-sop", str(stage))
    sop.run("npm", "--prefix", AUTO_FRONTEND, "ci", "--include=dev", "--ignore-scripts=false", "--package-lock=false", user=True)
    for command in ("test", "lint", "build"):
        sop.run("npm", "--prefix", AUTO_FRONTEND, "run", command, user=True)
    go = ["env", f"GOCACHE={stage / 'cache'}", f"GOPATH={stage / 'go'}", "CGO_ENABLED=0",
          str(AUTO_GO), "-C", str(sop.REPO / AUTO_SOURCE)]
    for command in ("test", "vet"):
        sop.run(*go, command, "./...", user=True)
    artifact = stage / "mxd-auto-process"
    sop.run(*go, "build", "-trimpath", "-ldflags=-s -w", "-o", str(artifact), "./cmd/mxd-auto-process", user=True)
    if not artifact.is_file() or artifact.stat().st_size == 0:
        raise RuntimeError("Auto build produced no executable")
    return artifact


def install_binary(source):
    """Atomically replace only the verified executable; database/key stay untouched."""
    if AUTO_BINARY.is_symlink() or AUTO_BINARY.resolve() != AUTO_BINARY:
        raise RuntimeError("Unsafe auto executable path")
    descriptor, temporary = tempfile.mkstemp(prefix=".security-release-", dir=AUTO_BINARY.parent)
    os.close(descriptor)
    try:
        shutil.copyfile(source, temporary)
        os.chmod(temporary, 0o755)
        os.replace(temporary, AUTO_BINARY)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
