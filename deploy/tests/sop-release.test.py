"""Regression checks for safe reconciliation and release rollback, without services."""
from pathlib import Path
from io import BytesIO
from email.message import Message
import subprocess
import sys
import tarfile
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sop_release_checks import verify_local_changes, verify_probe_responses
import importlib.util

spec = importlib.util.spec_from_file_location("sop_update", Path(__file__).resolve().parents[1] / "update-sop-security.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class SourceReconciliationTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="sop-release-test-")
        self.addCleanup(self.directory.cleanup)
        self.repo = Path(self.directory.name).resolve()
        self.git("init", "-b", "main")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "Release Test")
        self.existing = "backend/src/app.ts"
        self.added = "backend/src/modules/auth/interface/client-ip.ts"
        self.write(self.existing, "old\n")
        self.git("add", ".")
        self.git("commit", "-m", "base")
        self.base = self.git("rev-parse", "HEAD").decode().strip()
        self.write(self.existing, "published\n")
        self.write(self.added, "new file\n")
        self.git("add", ".")
        self.git("commit", "-m", "release")
        self.release = self.git("rev-parse", "HEAD").decode().strip()
        self.git("switch", "--detach", self.base)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True, capture_output=True).stdout

    def write(self, name, text):
        destination = self.repo / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(text.encode())

    def test_known_uploaded_files_can_be_stashed_and_fast_forwarded_without_loss(self):
        self.write(self.existing, "published\r\n")
        self.write(self.added, "new file\n")
        before = self.git("status", "--porcelain")
        self.assertEqual(set(verify_local_changes(self.repo, self.release, self.git)), {self.existing, self.added})
        self.assertEqual(self.git("status", "--porcelain"), before)
        self.git("stash", "push", "--include-untracked", "-m", "saved")
        self.git("merge", "--ff-only", self.release)
        self.assertEqual(self.git("rev-parse", "HEAD").decode().strip(), self.release)
        self.assertIn(b"published", self.git("show", "stash@{0}:" + self.existing))
        self.assertEqual(self.git("show", "stash@{0}^3:" + self.added), b"new file\n")

    def test_unknown_content_is_preserved_and_rejected(self):
        self.write(self.existing, "operator custom edit\n")
        with self.assertRaisesRegex(RuntimeError, "differs"):
            verify_local_changes(self.repo, self.release, self.git)
        self.assertEqual((self.repo / self.existing).read_text(), "operator custom edit\n")

    def test_unrelated_and_staged_changes_are_not_stashed(self):
        self.write("operator-notes.txt", "keep this\n")
        with self.assertRaisesRegex(RuntimeError, "Unknown local change"):
            verify_local_changes(self.repo, self.release, self.git)
        (self.repo / "operator-notes.txt").unlink()
        self.write(self.existing, "published\n")
        self.git("add", self.existing)
        with self.assertRaisesRegex(RuntimeError, "Unknown local change"):
            verify_local_changes(self.repo, self.release, self.git)
        self.assertTrue(self.git("diff", "--cached", "--name-only"))

    def test_clean_worktree_needs_no_stash(self):
        self.assertEqual(verify_local_changes(self.repo, self.release, self.git), [])


class ReleaseVerificationTest(unittest.TestCase):
    def response(self, status, body, content_type="application/json"):
        headers = Message()
        headers["Content-Type"] = content_type
        headers["Server"] = "cloudflare"
        headers["CF-Ray"] = "test-ray"
        return urllib.error.HTTPError("https://example.invalid/health", status, "fixture", headers, BytesIO(body))

    def test_html_error_reports_http_metadata_without_leaking_the_body(self):
        response = self.response(403, b"<html>private challenge body</html>", "text/html")
        response.headers["CF-Mitigated"] = "challenge"
        with patch.object(updater.urllib.request, "urlopen", side_effect=response):
            with self.assertRaisesRegex(ValueError, '"status": 403') as caught:
                updater.request("https://example.invalid/health")
        self.assertIn('"cf_mitigated": "challenge"', str(caught.exception))
        self.assertIn('"content_type": "text/html"', str(caught.exception))
        self.assertNotIn("private challenge body", str(caught.exception))

    def test_empty_or_non_object_success_is_not_a_healthy_json_response(self):
        for body in (b"", b"[]", b"null"):
            with self.subTest(body=body):
                with patch.object(updater.urllib.request, "urlopen", return_value=self.response(200, body)):
                    with self.assertRaisesRegex(ValueError, '"status": 200'):
                        updater.request("https://example.invalid/health")

    def test_json_http_errors_keep_the_login_contract(self):
        response = self.response(429, b'{"error":{"code":"login-blocked","retryAfterSeconds":1200}}')
        with patch.object(updater.urllib.request, "urlopen", side_effect=response):
            status, body = updater.request("https://example.invalid/login")
        self.assertEqual(status, 429)
        self.assertEqual(body["error"]["retryAfterSeconds"], 1200)

    def test_public_health_only_never_runs_deployment(self):
        with patch.object(updater, "deploy") as deploy, patch.object(updater, "check_public_health") as check:
            updater.main(["--check-public-health"])
        check.assert_called_once_with()
        deploy.assert_not_called()

    def test_public_health_uses_project_identity_and_accepts_healthy_json(self):
        response = self.response(200, b'{"status":"ok","catalogItems":5932}')
        with patch.object(updater.urllib.request, "urlopen", return_value=response) as get:
            with patch("builtins.print") as output:
                updater.check_public_health()
        request = get.call_args.args[0]
        self.assertEqual(request.get_header("User-agent"), "mxd-sop-release-check/1.0")
        self.assertEqual(request.get_header("Accept"), "application/json")
        output.assert_called_once_with("PUBLIC_HEALTH_OK; HTTP 200; status=ok", flush=True)

    def test_public_health_rejects_non_200_unhealthy_and_network_failures(self):
        for result in ((503, {"status": "ok"}), (200, {"status": "error"})):
            with patch.object(updater, "request", return_value=result):
                with self.assertRaises(updater.PublicHealthError):
                    updater.check_public_health()
        with patch.object(updater, "request", side_effect=urllib.error.URLError("unavailable")):
            with self.assertRaisesRegex(updater.PublicHealthError, "unavailable"):
                updater.check_public_health()

    def test_live_checks_reject_old_thresholds_and_accept_current_contract(self):
        rates = [(400, {})] * 10 + [(429, {"error": {"code": "login-rate-limited", "retryAfterSeconds": 300}})]
        locks = [(401, {})] * 4 + [(429, {"error": {"code": "login-blocked", "retryAfterSeconds": 1200}})]
        verify_probe_responses(rates, locks)
        with self.assertRaises(RuntimeError):
            verify_probe_responses(rates, [(401, {})] * 5)
        with self.assertRaises(RuntimeError):
            verify_probe_responses(rates[:-1] + [(429, {"error": {"code": "login-rate-limited", "retryAfterSeconds": 60}})], locks)

    def test_rollback_restores_only_generated_assets_and_preserves_business_data(self):
        with tempfile.TemporaryDirectory(prefix="sop-rollback-test-") as directory:
            repo = (Path(directory) / "repo").resolve()
            backup = Path(directory) / "backup"
            backup.mkdir()
            for name in ("backend/dist", "frontend/dist"):
                (repo / name).mkdir(parents=True)
                (repo / name / "old.txt").write_text("old")
            with tarfile.open(backup / "built-assets.tar.gz", "w:gz") as archive:
                for name in ("backend/dist", "frontend/dist"):
                    archive.add(repo / name, arcname=name)
            data = repo / "business.sqlite"
            data.write_bytes(b"business-data")
            (repo / "backend/dist/new.txt").write_text("new")
            with patch.object(updater, "REPO", repo), patch.object(updater, "run"):
                updater.restore_built_assets(backup)
            self.assertFalse((repo / "backend/dist/new.txt").exists())
            self.assertEqual((repo / "backend/dist/old.txt").read_text(), "old")
            self.assertEqual(data.read_bytes(), b"business-data")


if __name__ == "__main__":
    unittest.main(verbosity=2)
