"""Exercise shipped real-IP and login ingress policies without root or reloads."""
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest


class CloudflareRealIpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = os.environ.get("NGINX_BINARY") or shutil.which("nginx")
        if not cls.binary:
            raise RuntimeError("Install nginx or set NGINX_BINARY before running this integration test")
        cls.directory = tempfile.TemporaryDirectory(prefix="mxd-realip-test-")
        cls.addClassCleanup(cls.directory.cleanup)
        root = Path(cls.directory.name)
        snippet = Path(__file__).resolve().parents[1] / "security/mxd-cloudflare-realip.conf"
        # Only this ephemeral copy treats a loopback peer as a Cloudflare edge.
        policy = snippet.read_text(encoding="utf-8")
        if "set_real_ip_from 173.245.48.0/20;" not in policy:
            raise RuntimeError("The fixture needs review after a Cloudflare range update")
        policy = policy.replace("set_real_ip_from 173.245.48.0/20;", "set_real_ip_from 127.0.0.2/32;")
        guard = (snippet.parent / "mxd-login-guard.conf").read_text(encoding="utf-8")
        server_rules = (snippet.parent / "mxd-login-server.conf").read_text(encoding="utf-8")
        server_rules = server_rules.replace("/var/log/nginx/", str(root) + "/")
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            cls.port = listener.getsockname()[1]
        config = root / "nginx.conf"
        (root / "success.txt").write_text("ok", encoding="utf-8")
        servers = []
        for name in ["sop.test", "auto.test"]:
            servers.extend([
                "server {", f"listen 127.0.0.1:{cls.port}; server_name {name};", policy, server_rules,
                "location / { default_type application/json;",
                'return 200 \'{"client":"$remote_addr","forwarded":"$remote_addr"}\';', "}",
                # Static serving runs the access phases; a rewrite-phase return
                # would bypass limit_req and invalidate the ingress test.
                f"location /api/ {{ root {root}; try_files /success.txt =404; }}", "}",
            ])
        config.write_text("\n".join([
            "daemon off;", "master_process off;", f"pid {root}/nginx.pid;",
            f"error_log {root}/error.log;", "events {}", "http {", "access_log off;",
            f"client_body_temp_path {root}/client-body;", f"proxy_temp_path {root}/proxy;",
            f"fastcgi_temp_path {root}/fastcgi;", f"uwsgi_temp_path {root}/uwsgi;", f"scgi_temp_path {root}/scgi;",
            guard, *servers, "}",
        ]), encoding="utf-8")
        command = [cls.binary, "-e", str(root / "error.log"), "-p", str(root) + "/", "-c", str(config)]
        subprocess.run(command + ["-t"], check=True, capture_output=True, text=True)
        cls.process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.addClassCleanup(cls.stop_nginx)
        for _ in range(50):
            try:
                with socket.create_connection(("127.0.0.1", cls.port), timeout=0.1):
                    return
            except OSError:
                if cls.process.poll() is not None:
                    raise RuntimeError((root / "error.log").read_text())
                time.sleep(0.05)
        raise RuntimeError("Nginx did not become ready")

    @classmethod
    def stop_nginx(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait(timeout=5)

    def request(self, peer, headers):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2, source_address=(peer, 0))
        try:
            connection.request("GET", "/", headers=headers)
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            return json.loads(response.read())
        finally:
            connection.close()

    def test_trusted_edge_keeps_visitors_separate(self):
        for client in ["192.0.2.10", "192.0.2.11", "2001:db8::1"]:
            result = self.request("127.0.0.2", {"CF-Connecting-IP": client, "X-Forwarded-For": "198.51.100.1"})
            self.assertEqual(result["client"], client)
            self.assertEqual(result["forwarded"], client)

    def test_direct_client_cannot_forge_visitor_ip(self):
        for forged in ["192.0.2.10", "192.0.2.11"]:
            result = self.request("127.0.0.1", {"CF-Connecting-IP": forged, "X-Forwarded-For": forged})
            self.assertEqual(result["client"], "127.0.0.1")
            self.assertEqual(result["forwarded"], "127.0.0.1")

    def test_missing_or_invalid_header_falls_back_to_peer(self):
        for headers in [{}, {"CF-Connecting-IP": "invalid"}]:
            self.assertEqual(self.request("127.0.0.2", headers)["client"], "127.0.0.2")

    def status(self, host, route):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        try:
            connection.request("GET", route, headers={"Host": host})
            response = connection.getresponse()
            response.read()
            return response.status
        finally:
            connection.close()

    def test_sop_admits_ten_requests_across_aliases(self):
        responses = [self.status("sop.test", "/api/v1/login" if i % 2 else "/api/v1/auth/login") for i in range(11)]
        self.assertEqual(responses, [200] * 10 + [429])
        self.assertEqual(self.status("sop.test", "/api/v1/auth/me"), 200)

    def test_auto_retains_its_independent_six_request_burst(self):
        responses = [self.status("auto.test", "/api/v1/operator/login") for _ in range(7)]
        self.assertEqual(responses, [200] * 6 + [429])


if __name__ == "__main__":
    unittest.main(verbosity=2)
