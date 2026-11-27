"""Loopback-only SSH/SFTP fixture; never executes commands on the host machine."""
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from ftp_fixture import FTPFixture
from sftp_transfer import BrokenTransferHandle

import paramiko
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519


class SlowReadHandle(paramiko.SFTPHandle):
    def read(self, offset, length):
        time.sleep(0.05)
        return super().read(offset, length)


class Files(paramiko.SFTPServerInterface):
    root = None

    def __init__(self, server, *args, **kwargs):
        super().__init__(server, *args, **kwargs)
        self.transport = server.transport

    def local(self, path):
        destination = self.root / path.lstrip("/")
        if not destination.resolve().is_relative_to(self.root):
            raise PermissionError("Outside fixture")
        return destination

    def list_folder(self, path):
        try:
            entries = []
            for item in self.local(path).iterdir():
                entry = paramiko.SFTPAttributes.from_stat(item.lstat())
                entry.filename = item.name
                entries.append(entry)
            return entries
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno or 13)

    def stat(self, path):
        return self.attributes(path, True)

    def lstat(self, path):
        return self.attributes(path, False)

    def attributes(self, path, follow):
        if path == "/denied":
            return paramiko.SFTP_PERMISSION_DENIED
        try:
            item = self.local(path)
            return paramiko.SFTPAttributes.from_stat(item.stat() if follow else item.lstat())
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno or 13)

    def open(self, path, flags, attr):
        try:
            descriptor = os.open(self.local(path), flags, 0o644)
            mode = "r+b" if flags & os.O_RDWR else "wb" if flags & os.O_WRONLY else "rb"
            stream = os.fdopen(descriptor, mode)
            handle = SlowReadHandle(flags) if path == "/slow-transfer.bin" else paramiko.SFTPHandle(flags)
            if path == "/broken-sftp-download.bin" or (
                path == "/broken-sftp-upload.bin" and flags & (os.O_WRONLY | os.O_RDWR)
            ):
                handle = BrokenTransferHandle(flags, self.transport.close)
            handle.readfile = stream
            handle.writefile = stream
            return handle
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno or 13)

    def mkdir(self, path, attr):
        return self.perform(lambda: self.local(path).mkdir())

    def rmdir(self, path):
        return self.perform(lambda: self.local(path).rmdir())

    def remove(self, path):
        return self.perform(lambda: self.local(path).unlink())

    def rename(self, source, target):
        return self.perform(lambda: self.local(source).rename(self.local(target)))

    def readlink(self, path):
        return os.readlink(self.local(path))

    def perform(self, operation):
        try:
            operation()
            return paramiko.SFTP_OK
        except OSError as error:
            return paramiko.SFTPServer.convert_errno(error.errno or 13)


class Server(paramiko.ServerInterface):
    def check_auth_password(self, username, password):
        return paramiko.AUTH_SUCCESSFUL if (username, password) == ("fixture", "fixture-password") else paramiko.AUTH_FAILED

    def check_auth_publickey(self, username, key):
        return paramiko.AUTH_SUCCESSFUL if username == "fixture" and key in user_keys else paramiko.AUTH_FAILED

    def get_allowed_auths(self, username):
        return "password,publickey"

    def check_channel_request(self, kind, channel_id):
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        self.dimensions = (width, height)
        return True

    def check_channel_window_change_request(self, channel, width, height, pixelwidth, pixelheight):
        self.dimensions = (width, height)
        return True

    def check_channel_shell_request(self, channel):
        threading.Thread(target=self.shell, args=(channel,), daemon=True).start()
        return True

    def check_channel_exec_request(self, channel, command):
        threading.Thread(target=self.execute, args=(channel, command), daemon=True).start()
        return True

    def shell(self, channel):
        try:
            channel.sendall("ready ✓\r\n".encode())
            pending = b""
            while data := channel.recv(32768):
                pending += data
                while b"\n" in pending:
                    line, pending = pending.split(b"\n", 1)
                    if line == b"size":
                        channel.sendall(f"size:{self.dimensions[0]}x{self.dimensions[1]}\r\n".encode())
                    elif line == b"exit":
                        channel.send_exit_status(7)
                        return
                    else:
                        channel.sendall(line + b"\n")
        finally:
            channel.close()

    def execute(self, channel, command):
        try:
            if command == b"quiet":
                time.sleep(1.2)
            channel.sendall(("Acode ✓ 日本語\n" * 9000 if command == b"large" else "stdout ✓\n").encode())
            channel.sendall_stderr(b"stderr\n")
            channel.send_exit_status(17)
        finally:
            channel.close()


class Configuration(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps(config).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def accept_connections(listener, silent=False):
    while True:
        try:
            connection, address = listener.accept()
        except OSError:
            return
        if silent:
            connections.append(connection)
            continue
        transport = paramiko.Transport(connection)
        connections.append(transport)
        transport.add_server_key(host_key)
        transport.set_subsystem_handler("sftp", paramiko.SFTPServer, Files)
        try:
            server = Server()
            server.transport = transport
            transport.start_server(server=server)
        except (EOFError, paramiko.SSHException):
            transport.close()


def listen():
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    return listener


if __name__ == "__main__":
    host_key = paramiko.RSAKey.generate(2048)
    user_key = paramiko.RSAKey.generate(2048)
    ed_key = ed25519.Ed25519PrivateKey.generate().private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.OpenSSH, serialization.BestAvailableEncryption(b"fixture-passphrase")).decode()
    user_keys = [user_key, paramiko.Ed25519Key.from_private_key(io.StringIO(ed_key), password="fixture-passphrase")]
    pem = io.StringIO()
    user_key.write_private_key(pem, password="fixture-passphrase")
    ssh, silent = listen(), listen()
    connections = []
    config = {"port": ssh.getsockname()[1], "silentPort": silent.getsockname()[1], "hostKey": host_key.get_base64(), "privateKey": pem.getvalue(), "ed25519Key": ed_key}
    with tempfile.TemporaryDirectory(prefix="acode-ssh-fixture-") as directory:
        Files.root = Path(directory).resolve()
        (Files.root / "target.txt").write_text("target")
        (Files.root / "slow-transfer.bin").write_bytes(bytes(range(256)) * 32768)
        (Files.root / "broken-sftp-download.bin").write_bytes(bytes(range(256)) * 32768)
        (Files.root / "relative-link").symlink_to("target.txt")
        (Files.root / "broken-link").symlink_to("missing.txt")
        ftp = FTPFixture(Files.root)
        config.update(ftp.config)
        http = ThreadingHTTPServer(("127.0.0.1", 22199), Configuration)
        for target, arguments in [(accept_connections, (ssh,)), (accept_connections, (silent, True)), (http.serve_forever, ())]:
            threading.Thread(target=target, args=arguments, daemon=True).start()
        try:
            if len(sys.argv) > 2 and sys.argv[1] == "--":
                result = subprocess.run(sys.argv[2:])
                sys.exit(result.returncode)
            print("SSH fixture ready on 127.0.0.1:22199", flush=True)
            threading.Event().wait()
        finally:
            ftp.close()
            for connection in connections:
                connection.close()
            http.shutdown()
            http.server_close()
            ssh.close()
            silent.close()
