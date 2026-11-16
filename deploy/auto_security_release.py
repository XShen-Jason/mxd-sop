"""Auto-specific staging/backup helpers for the explicitly requested joint release."""
import os
from contextlib import closing
from pathlib import Path
import re
import shlex
import shutil
import sqlite3
import tempfile

AUTO_BINARY = Path("/opt/mxd-auto-process/bin/mxd-auto-process")
AUTO_DATABASE = Path("/var/lib/mxd-auto-process/auto.sqlite")
AUTO_KEY = Path("/var/lib/mxd-auto-process/auto-credentials.key")
AUTO_ENV = Path("/etc/mxd-auto-process/mxd-auto-process.env")
AUTO_GO = Path("/opt/mxd-auto-process/toolchain/bin/go")
AUTO_TOOLCHAIN_ENV = Path("/opt/mxd-auto-process/toolchain.env")
AUTO_SOURCE = "mxd-auto-process/backend-auto-process"
AUTO_FRONTEND = "mxd-auto-process/frontend-auto-process"


def configured_go():
    """Read the Debian manual's literal GO_BIN without executing shell content.

    The fixed path is only for installations made with the separate Ubuntu guide.
    An existing but invalid config never falls back silently to another compiler.
    """
    if not AUTO_TOOLCHAIN_ENV.exists():
        candidate = AUTO_GO
    else:
        matches = re.findall(r"^(?:export\s+)?GO_BIN\s*=(.*)$", AUTO_TOOLCHAIN_ENV.read_text(), re.MULTILINE)
        if len(matches) != 1:
            raise RuntimeError("toolchain.env must contain exactly one literal GO_BIN assignment")
        values = shlex.split(matches[0], comments=True)
        if len(values) != 1 or any(character in values[0] for character in "$`\r\n"):
            raise RuntimeError("GO_BIN must be a literal absolute path, without shell expansion")
        candidate = Path(values[0])
    if not candidate.is_absolute() or not candidate.is_file():
        raise RuntimeError("Go compiler missing: check GO_BIN in /opt/mxd-auto-process/toolchain.env")
    # Package-manager symlinks are valid compiler paths; data/key checks remain strict.
    return candidate.resolve()


def verified_go(sop, release):
    """Verify the chosen compiler as the actual build user against the pinned source."""
    go = configured_go()
    module = sop.git("show", f"{release}:{AUTO_SOURCE}/go.mod").decode()
    minimum = re.search(r"^go (\d+)\.(\d+)(?:\.(\d+))?\s*$", module, re.MULTILINE)
    version = sop.run("env", "GOTOOLCHAIN=local", str(go), "env", "GOVERSION", capture=True, user=True).decode().strip()
    current = re.fullmatch(r"go(\d+)\.(\d+)(?:\.(\d+))?", version)
    if not minimum or not current or tuple(int(n or 0) for n in current.groups()) < tuple(int(n or 0) for n in minimum.groups()):
        raise RuntimeError("Configured Go is not a stable version satisfying the target go.mod")
    print(f"AUTO_GO_OK; {go}; {version}", flush=True)
    return go


def preflight_auto(sop, release):
    """Require the existing Debian installation; return domain and verified compiler."""
    if str(AUTO_BINARY) not in sop.service_value("mxd-auto-process", "ExecStart"):
        raise RuntimeError("Unexpected auto service entry point")
    for file in (AUTO_BINARY, AUTO_DATABASE, AUTO_KEY, AUTO_ENV):
        if not file.is_file() or file.is_symlink():
            raise RuntimeError(f"Expected an existing regular deployment file: {file}")
    values = {}
    for line in AUTO_ENV.read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key in ("AUTO_DATABASE_PATH", "AUTO_CREDENTIAL_KEY_PATH", "AUTO_DOMAIN"):
            values[key] = value.strip().strip('"').strip("'")
    if values.get("AUTO_DATABASE_PATH") != str(AUTO_DATABASE) or values.get("AUTO_CREDENTIAL_KEY_PATH") != str(AUTO_KEY):
        raise RuntimeError("Auto data paths differ from the documented deployment; no files changed")
    # DEPLOYMENT-MXD-AUTO-26909.md uses this fixed hostname and does not require
    # AUTO_DOMAIN; retain the explicit override used by the separate Ubuntu guide.
    domain = values.get("AUTO_DOMAIN", "mxd-auto-process.5202345.xyz")
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}", domain):
        raise RuntimeError("AUTO_DOMAIN is missing or invalid")
    return domain, verified_go(sop, release)


def backup_auto(backup):
    # Root-only parent already created by SOP backup. Keep secrets on this host.
    shutil.copy2(AUTO_BINARY, backup / "auto-binary")
    shutil.copy2(AUTO_ENV, backup / "auto.env")
    shutil.copy2(AUTO_KEY, backup / "auto-credentials.key")
    with closing(sqlite3.connect(AUTO_DATABASE.as_uri() + "?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(backup / "auto.sqlite")) as destination:
            source.backup(destination)


def build_auto(sop, go_binary, release):
    """Export pinned source before building, as in DEPLOYMENT-UPDATE.md section 4.

    Both frontend embedding and Go caches stay in staging. A running executable
    or the server's source worktree is never overwritten by build output.
    """
    stage = Path(tempfile.mkdtemp(prefix="mxd-auto-security-", dir="/var/tmp"))
    sop.run("chown", "mxd-sop:mxd-sop", str(stage))
    archive = stage / "source.tar"
    sop.run("git", "-c", "core.fileMode=false", "archive", "--format=tar", "--output", str(archive), release, "mxd-auto-process", user=True)
    sop.run("tar", "-xf", str(archive), "-C", str(stage), user=True)
    frontend = str(stage / AUTO_FRONTEND)
    sop.run("npm", "--prefix", frontend, "ci", "--include=dev", "--ignore-scripts=false", "--package-lock=false", user=True)
    for command in ("test", "lint", "build"):
        sop.run("npm", "--prefix", frontend, "run", command, user=True)
    go = ["env", "GOTOOLCHAIN=local", f"GOCACHE={stage / 'cache'}", f"GOPATH={stage / 'go'}", "CGO_ENABLED=0",
          str(go_binary), "-C", str(stage / AUTO_SOURCE)]
    for command in ("test", "vet"):
        sop.run(*go, command, "./...", user=True)
    # The archive creates stage/mxd-auto-process as a SOURCE DIRECTORY. Go treats
    # '-o <existing directory>' as a container, so use the manual's distinct filename.
    artifact = stage / "mxd-auto-process.new"
    if artifact.exists() or artifact.is_symlink():
        raise RuntimeError(f"Auto output path already exists: {artifact}")
    sop.run(*go, "build", "-trimpath", "-ldflags=-s -w", "-o", str(artifact), "./cmd/mxd-auto-process", user=True)
    if not artifact.is_file() or artifact.is_symlink() or artifact.stat().st_size == 0:
        raise RuntimeError(f"Auto build produced no regular executable at {artifact}")
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
