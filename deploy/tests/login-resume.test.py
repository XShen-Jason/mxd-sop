"""Verify retry after Git advanced while failed build left old Nginx/runtime live."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY))
spec = importlib.util.spec_from_file_location("joint_release", DEPLOY / "update-login-security.py")
joint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(joint)


class ResumeConfigTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.backup = self.root / "security-release-prior"
        self.backup.mkdir()
        self.old, self.head = "1" * 40, "2" * 40
        (self.backup / "before-head").write_text(self.old)
        (self.backup / "target-head").write_text(self.head)
        self.installed = self.root / "installed.conf"
        self.installed.write_bytes(b"old config\n")
        (self.backup / "guard.conf").write_bytes(b"old config\n")
        def git(*args):
            if args[0] == "rev-parse":
                return self.head.encode()
            if args[0] == "merge-base":
                if args[2:] != (self.old, self.head):
                    raise subprocess.CalledProcessError(1, "git merge-base")
                return b""
            if args == ("show", f"{self.old}:deploy/security/guard.conf"):
                return b"old config\n"
            return b"new config\n"
        for mocked in (patch.object(joint, "BACKUP_ROOT", self.root),
                       patch.object(joint.sop, "CONFIGS", {"guard.conf": self.installed}),
                       patch.object(joint.sop, "git", side_effect=git)):
            mocked.start()
            self.addCleanup(mocked.stop)

    def test_git_advanced_requires_explicit_matching_backup(self):
        with self.assertRaisesRegex(RuntimeError, "Git baseline"):
            joint.verify_installed_configs()
        self.assertEqual(joint.verify_installed_configs(self.backup), self.old)
        self.assertEqual(self.installed.read_bytes(), b"old config\n")
        self.assertEqual((self.backup / "target-head").read_text(), self.head)

    def test_backup_never_authorizes_unknown_installed_config(self):
        self.installed.write_bytes(b"operator customization\n")
        (self.backup / "guard.conf").write_bytes(b"operator customization\n")
        with self.assertRaisesRegex(RuntimeError, "Git baseline"):
            joint.verify_installed_configs(self.backup)

    def test_saved_snapshot_must_match_even_when_git_matches(self):
        (self.backup / "guard.conf").write_bytes(b"different snapshot\n")
        with self.assertRaisesRegex(RuntimeError, "selected backup"):
            joint.verify_installed_configs(self.backup)

    def test_stale_or_unrelated_backup_is_rejected(self):
        (self.backup / "target-head").write_text("3" * 40)
        with self.assertRaisesRegex(RuntimeError, "current Git HEAD"):
            joint.verify_installed_configs(self.backup)
        (self.backup / "target-head").write_text(self.head)
        (self.backup / "before-head").write_text("4" * 40)
        with self.assertRaises(subprocess.CalledProcessError):
            joint.verify_installed_configs(self.backup)

    def test_repeated_retry_uses_original_config_commit_not_advanced_source(self):
        (self.backup / "before-head").write_text(self.head)
        (self.backup / "nginx-source-head").write_text(self.old)
        self.assertEqual(joint.verify_installed_configs(self.backup), self.old)

    def test_invalid_metadata_or_path_is_rejected(self):
        (self.backup / "before-head").write_text("HEAD~1")
        with self.assertRaisesRegex(RuntimeError, "Invalid backup commit"):
            joint.verify_installed_configs(self.backup)
        with self.assertRaisesRegex(RuntimeError, "exact regular"):
            joint.verify_installed_configs(self.root)


if __name__ == "__main__":
    unittest.main(verbosity=2)
