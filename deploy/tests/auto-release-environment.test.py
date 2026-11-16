"""Regression coverage for the Debian installation described in DEPLOYMENT-UPDATE.md."""
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY))
import auto_security_release as auto


class AutoEnvironmentTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        for name in ("AUTO_BINARY", "AUTO_DATABASE", "AUTO_KEY", "AUTO_ENV"):
            target = self.root / name
            target.write_text("existing")
            mocked = patch.object(auto, name, target)
            mocked.start()
            self.addCleanup(mocked.stop)
        self.go = self.root / "custom compiler" / "bin" / "go"
        self.go.parent.mkdir(parents=True)
        self.go.write_text("fake executable")
        self.toolchain_env = self.root / "toolchain.env"
        self.toolchain_env.write_text(f"GO_BIN='{self.go.as_posix()}'\n")
        for name, value in (("AUTO_TOOLCHAIN_ENV", self.toolchain_env), ("AUTO_GO", self.root / "absent-go")):
            mocked = patch.object(auto, name, value, create=True)
            mocked.start()
            self.addCleanup(mocked.stop)
        auto.AUTO_ENV.write_text(f"AUTO_DATABASE_PATH={auto.AUTO_DATABASE}\nAUTO_CREDENTIAL_KEY_PATH={auto.AUTO_KEY}\n")
        self.sop = Mock(REPO=self.root)
        self.sop.service_value.return_value = str(auto.AUTO_BINARY)
        self.sop.run.return_value = b"go1.23.12\n"
        self.sop.git.return_value = b"module example.invalid/auto\n\ngo 1.23\n"
        self.release = "a" * 40

    def test_documented_installation_uses_configured_go_and_default_domain(self):
        # The documented installation has toolchain.env, no fixed compiler path,
        # and no AUTO_DOMAIN in the service env. None of these is a missing install.
        domain, go = auto.preflight_auto(self.sop, self.release)
        self.assertEqual(domain, "mxd-auto-process.5202345.xyz")
        self.assertEqual(go, self.go)
        self.sop.run.assert_called_once_with("env", "GOTOOLCHAIN=local", str(self.go), "env", "GOVERSION", capture=True, user=True)
        self.sop.git.assert_called_once_with("show", f"{self.release}:{auto.AUTO_SOURCE}/go.mod")

    def test_explicit_domain_is_preserved(self):
        with auto.AUTO_ENV.open("a") as stream:
            stream.write("AUTO_DOMAIN=custom.example.com\n")
        self.assertEqual(auto.preflight_auto(self.sop, self.release)[0], "custom.example.com")

    def test_ubuntu_fixed_path_is_used_only_without_the_debian_config(self):
        self.toolchain_env.unlink()
        with patch.object(auto, "AUTO_GO", self.go):
            self.assertEqual(auto.configured_go(), self.go)
        with self.assertRaisesRegex(RuntimeError, "check GO_BIN"):
            auto.configured_go()

    def test_config_is_literal_and_invalid_config_never_falls_back(self):
        invalid = ["", "OTHER=ignored\n", "GO_BIN=relative/go\n", "GO_BIN=/not/installed/go\n",
                   "GO_BIN=$(touch /tmp/do-not-run)\n", "GO_BIN=`echo /bin/go`\n",
                   "GO_BIN=$HOME/go/bin/go\n", "GO_BIN=/one\nGO_BIN=/two\n"]
        with patch.object(auto, "AUTO_GO", self.go):
            for content in invalid:
                with self.subTest(content=content):
                    self.toolchain_env.write_text(content)
                    with self.assertRaises((RuntimeError, ValueError)):
                        auto.configured_go()
        self.sop.run.assert_not_called()

    def test_version_check_uses_pinned_module_requirement_and_build_user(self):
        for actual in (b"go1.22.12\n", b"go1.23rc1\n", b"devel go1.24\n"):
            with self.subTest(actual=actual):
                self.sop.run.return_value = actual
                with self.assertRaisesRegex(RuntimeError, "target go.mod"):
                    auto.preflight_auto(self.sop, self.release)
                self.assertTrue(self.sop.run.call_args.kwargs["user"])
        self.sop.run.return_value = b"go1.23.12\n"
        self.sop.git.return_value = b"module example.invalid/auto\ngo 1.24\n"
        with self.assertRaisesRegex(RuntimeError, "target go.mod"):
            auto.preflight_auto(self.sop, self.release)

    def test_build_user_access_failure_is_not_ignored(self):
        self.sop.run.side_effect = PermissionError("build user cannot execute compiler")
        with self.assertRaises(PermissionError):
            auto.preflight_auto(self.sop, self.release)

    def test_build_uses_pinned_staged_source_and_the_verified_compiler(self):
        stage = self.root / "stage"
        stage.mkdir()
        existing_asset = self.root / auto.AUTO_SOURCE / "internal/operatorapi/assets/index.html"
        existing_asset.parent.mkdir(parents=True)
        existing_asset.write_text("existing worktree asset")
        artifact = stage / "mxd-auto-process.new"
        def run(*args, **kwargs):
            if args[0] == "tar":
                (stage / "mxd-auto-process").mkdir()
            if "./cmd/mxd-auto-process" in args:
                artifact.write_bytes(b"built binary")
        self.sop.run.side_effect = run
        with patch.object(auto.tempfile, "mkdtemp", return_value=str(stage)):
            self.assertEqual(auto.build_auto(self.sop, self.go, self.release), artifact)
        calls = [call.args for call in self.sop.run.call_args_list]
        self.assertIn(("git", "-c", "core.fileMode=false", "archive", "--format=tar", "--output",
                       str(stage / "source.tar"), self.release, "mxd-auto-process"), calls)
        npm_calls = [call for call in calls if call[0] == "npm"]
        self.assertEqual([call[2] for call in npm_calls], [str(stage / auto.AUTO_FRONTEND)] * 4)
        go_calls = [call for call in calls if str(self.go) in call]
        self.assertEqual(len(go_calls), 3)
        for call in go_calls:
            self.assertIn("GOTOOLCHAIN=local", call)
            self.assertEqual(call[call.index("-C") + 1], str(stage / auto.AUTO_SOURCE))
        self.assertLess(calls.index(npm_calls[-1]), calls.index(go_calls[0]))
        self.assertTrue(all(call.kwargs.get("user") for call in self.sop.run.call_args_list[1:]))
        self.assertEqual(existing_asset.read_text(), "existing worktree asset")
        self.assertTrue((stage / "mxd-auto-process").is_dir())


class RealGoArtifactTest(unittest.TestCase):
    @unittest.skipUnless(all(shutil.which(tool) for tool in ("go", "git", "tar")), "requires Go, Git and tar")
    def test_exported_directory_cannot_be_mistaken_for_the_compiled_binary(self):
        # Git archive must really create stage/mxd-auto-process. Mocking extraction
        # previously hid Go's '-o existing-directory' behavior and this regression.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            repository, stage = root / "repo", root / "stage"
            source = repository / auto.AUTO_SOURCE
            (source / "cmd/mxd-auto-process").mkdir(parents=True)
            (source / "go.mod").write_text("module example.invalid/release-probe\n\ngo 1.23\n")
            (source / "cmd/mxd-auto-process/main.go").write_text('package main\nfunc main() { println("artifact-ok") }\n')
            stage.mkdir()
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=repository, stderr=subprocess.STDOUT)
            git("init", "--quiet")
            git("add", ".")
            git("-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", "commit", "--quiet", "-m", "fixture")
            release = git("rev-parse", "HEAD").decode().strip()
            compiler = Path(shutil.which("go")).resolve()
            def run(*args, **kwargs):
                if args[0] in ("chown", "npm"):
                    return  # No service users or frontend dependencies in this tiny Go fixture.
                command, environment = list(args), os.environ.copy()
                if command[0] == "env":
                    command.pop(0)
                    while command and "=" in command[0]:
                        key, value = command.pop(0).split("=", 1)
                        environment[key] = value
                    if "build" in command:
                        environment.update(GOOS="linux", GOARCH="amd64")
                subprocess.run(command, cwd=repository, env=environment, check=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            sop = Mock(REPO=repository, run=run)
            with patch.object(auto.tempfile, "mkdtemp", return_value=str(stage)):
                artifact = auto.build_auto(sop, compiler, release)
            self.assertTrue((stage / "mxd-auto-process").is_dir())
            self.assertEqual(artifact.parent, stage)
            self.assertNotEqual(artifact, stage / "mxd-auto-process")
            self.assertEqual(artifact.read_bytes()[:4], b"\x7fELF")
            metadata = subprocess.check_output([str(compiler), "version", "-m", str(artifact)])
            self.assertIn(b"GOOS=linux", metadata)


if __name__ == "__main__":
    unittest.main(verbosity=2)
