"""Read-only checks for reconciling the previously deployed SOP security patch."""
import hashlib
from pathlib import Path

# These are the ten files reported on HK-MXD before Git synchronization.
# Anything else is an unknown local edit and must survive untouched.
RECONCILABLE_FILES = {
    "backend/src/app.ts",
    "backend/src/modules/auth/domain/service.ts",
    "backend/src/modules/auth/interface/http.ts",
    "backend/src/modules/auto-integration/domain/service.ts",
    "backend/src/modules/auto-integration/infrastructure/http-client.ts",
    "backend/src/modules/auto-integration/interface/http.ts",
    "backend/src/modules/operation-groups/interface/http.ts",
    "backend/src/modules/auth/domain/login-limiter.ts",
    "backend/src/modules/auth/interface/client-ip.ts",
    "backend/src/modules/auto-integration/domain/service-token.ts",
}

# LF-normalized SHA-256 of the limiter deployed before the requested threshold
# change. The source was the prior 60-second/5-request, 11-failure/10-minute version.
# This is deployment provenance, not a second owner of authentication rules.
LEGACY_LIMITER_SHA256 = "c8f4d8afc4709a1a316e494a14273cdaad0194521daeed77f876c01104d3bf30"


def normalized(content: bytes) -> bytes:
    return content.replace(b"\r\n", b"\n")


def verify_local_changes(repo: Path, release: str, git) -> list[str]:
    """Return known edits safe to stash; reject all unknown/staged/deleted content.

    ``git`` executes read-only Git arguments and returns bytes. It runs as the
    repository owner in production and against an isolated repository in tests.
    This function never modifies files, the index, branches or the stash.
    """
    records = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split(b"\0")
    changes = []
    for record in filter(None, records):
        status, name = record[:2].decode(), record[3:].decode("utf-8")
        if status not in (" M", "??") or name not in RECONCILABLE_FILES:
            raise RuntimeError(f"Unknown local change; preserved without modification: {status} {name}")
        file = repo / name
        if not file.is_file() or file.is_symlink():
            raise RuntimeError(f"Expected a regular source file: {name}")
        actual = normalized(file.read_bytes())
        expected = normalized(git("show", f"{release}:{name}"))
        legacy = name.endswith("/auth/domain/login-limiter.ts") and hashlib.sha256(actual).hexdigest() == LEGACY_LIMITER_SHA256
        if actual != expected and not legacy:
            raise RuntimeError(f"Local source differs from both the published release and known deployed patch: {name}")
        changes.append(name)
    return changes


def verify_probe_responses(rate_results, lock_results):
    """Verify real HTTP behavior without real users, passwords or session tokens."""
    if [status for status, _ in rate_results] != [400] * 10 + [429]:
        raise RuntimeError("Live request limit did not enforce the expected ten-request boundary")
    if [status for status, _ in lock_results] != [401] * 4 + [429]:
        raise RuntimeError("Live credential failures did not lock on the fifth failure")
    for (_, payload), code, minimum, maximum in [
        (rate_results[-1], "login-rate-limited", 290, 300),
        (lock_results[-1], "login-blocked", 1190, 1200),
    ]:
        error = payload.get("error", {})
        if error.get("code") != code or not minimum <= error.get("retryAfterSeconds", -1) <= maximum:
            raise RuntimeError(f"Unexpected live retry interval for {code}")
