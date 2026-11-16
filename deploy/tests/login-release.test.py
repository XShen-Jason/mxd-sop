"""Exercise exact unban scope, executable replacement and joint rollback without services."""
import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY))
import auto_security_release as auto


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, DEPLOY / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


admin = module("ip_admin", "ip-ban-admin.py")
joint = module("joint_release", "update-login-security.py")


class LoginReleaseTest(unittest.TestCase):
    def test_public_check_uses_ipv4_and_rejects_non_json_success(self):
        with patch.object(joint.sop, "run", return_value=b'{"status":"ok"}\n200\napplication/json') as run:
            joint.check_public_ipv4("https://example.invalid/health")
            self.assertIn("--ipv4", run.call_args.args)
            self.assertNotIn("--insecure", run.call_args.args)
        with patch.object(joint.sop, "run", return_value=b'private-body\n200\ntext/html'):
            with self.assertRaisesRegex(RuntimeError, '"status": "200"') as caught:
                joint.check_public_ipv4("https://example.invalid/health")
            self.assertNotIn("private-body", str(caught.exception))

    def test_inspection_and_unban_touch_only_one_address_in_one_service(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "ops.sqlite"
            with closing(sqlite3.connect(database)) as connection, connection:
                for table in ("auth_ip_failures", "operator_ip_failures"):
                    connection.execute(f"CREATE TABLE {table} (ip TEXT PRIMARY KEY, failures INTEGER)")
                    connection.executemany(f"INSERT INTO {table} VALUES (?, ?)", [("192.0.2.1", 21), ("192.0.2.2", 4)])
            result = admin.inspect_or_clear(database, "auth_ip_failures", "::ffff:192.0.2.1")
            self.assertEqual(result, {"ip": "192.0.2.1", "previous_failures": 21, "cleared": False})
            self.assertTrue(admin.inspect_or_clear(database, "auth_ip_failures", "192.0.2.1", True)["cleared"])
            self.assertEqual(admin.inspect_or_clear(database, "auth_ip_failures", "192.0.2.2")["previous_failures"], 4)
            self.assertEqual(admin.inspect_or_clear(database, "operator_ip_failures", "192.0.2.1")["previous_failures"], 21)
            with self.assertRaises(ValueError):
                admin.inspect_or_clear(database, "auth_ip_failures", "2001:db8::1", True)
            with self.assertRaises(sqlite3.OperationalError):
                admin.inspect_or_clear(Path(directory) / "missing.sqlite", "auth_ip_failures", "192.0.2.1", True)
            self.assertFalse((Path(directory) / "missing.sqlite").exists())

    def test_binary_install_and_rollback_leave_database_and_key_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            target, staged, old, data = [root / name for name in ("binary", "new", "old", "auto.sqlite")]
            target.write_bytes(b"old-binary")
            old.write_bytes(b"old-binary")
            staged.write_bytes(b"new-binary")
            data.write_bytes(b"live-business-data")
            key = root / "auto-credentials.key"
            key.write_bytes(b"existing-key")
            with patch.object(auto, "AUTO_BINARY", target):
                auto.install_binary(staged)
                self.assertEqual(target.read_bytes(), b"new-binary")
                auto.install_binary(old)
            self.assertEqual(target.read_bytes(), b"old-binary")
            self.assertEqual(data.read_bytes(), b"live-business-data")
            self.assertEqual(key.read_bytes(), b"existing-key")

    def test_build_failure_never_switches_or_restarts_services(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / "guard.conf"
            config.write_bytes(b"current")
            def git(*args):
                return b"current" if args[0] == "show" else b"a" * 40 if args[0] == "rev-parse" else b""
            with patch.object(joint.sop, "preflight", return_value=[]), patch.object(joint.sop, "git", side_effect=git), \
                 patch.object(joint, "preflight_auto", return_value=("auto.example.com", Path("/configured/go"))), patch.object(joint.sop, "CONFIGS", {"guard.conf": config}), \
                 patch.object(joint.sop, "service_value", return_value="42"), patch.object(joint.sop, "make_backup", return_value=root), \
                 patch.object(joint, "backup_auto"), patch.object(joint.sop, "build_release", side_effect=RuntimeError("build failed")), \
                 patch.object(joint.sop, "restore_built_assets") as restore, patch.object(joint, "install_binary") as install, \
                 patch.object(joint.sop, "run") as run:
                with self.assertRaisesRegex(RuntimeError, "build failed"):
                    joint.deploy("a" * 40)
            restore.assert_called_once_with(root)
            install.assert_not_called()
            self.assertEqual([call.args for call in run.call_args_list], [("curl", "--version")])
            self.assertEqual(config.read_bytes(), b"current")

    def test_failed_switch_restores_both_runtimes_and_config_without_restoring_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup = root / "backup"
            backup.mkdir()
            config, artifact = root / "guard.conf", root / "new-binary"
            config.write_bytes(b"current")
            (backup / "guard.conf").write_bytes(b"current")
            artifact.write_bytes(b"new")
            release = "a" * 40
            def git(*args):
                return b"current" if args[0] == "show" else release.encode() if args[0] == "rev-parse" else b""
            with patch.object(joint.sop, "preflight", return_value=[]), patch.object(joint.sop, "git", side_effect=git), \
                 patch.object(joint, "preflight_auto", return_value=("auto.example.com", Path("/configured/go"))), patch.object(joint.sop, "CONFIGS", {"guard.conf": config}), \
                 patch.object(joint.sop, "service_value", return_value="42"), patch.object(joint.sop, "make_backup", return_value=backup), \
                 patch.object(joint, "backup_auto"), patch.object(joint.sop, "build_release"), patch.object(joint, "build_auto", return_value=artifact), \
                 patch.object(joint.sop, "restore_built_assets") as restore, patch.object(joint, "install_binary") as install, \
                 patch.object(joint.sop, "run") as run, patch.object(joint, "wait_auto", side_effect=[RuntimeError("unhealthy"), None]), \
                 patch.object(joint.sop, "wait_for_health"):
                with self.assertRaisesRegex(RuntimeError, "unhealthy"):
                    joint.deploy(release)
            self.assertEqual([call.args[0] for call in install.call_args_list], [artifact, backup / "auto-binary"])
            restore.assert_called_once_with(backup)
            calls = [call.args for call in run.call_args_list]
            self.assertIn(("systemctl", "restart", "mxd-auto-process", "mxd-sop"), calls)
            self.assertFalse(any("sshd" in call or "mxd-player" in call for call in calls))
            self.assertEqual(config.read_bytes(), b"current")


if __name__ == "__main__":
    unittest.main(verbosity=2)
