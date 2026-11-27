"""Disposable loopback FTP, explicit FTPS and implicit FTPS test servers."""
from datetime import datetime, timedelta, timezone
import logging
from pathlib import Path
import threading

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler, TLS_DTPHandler, TLS_FTPHandler, ThrottledDTPHandler
from pyftpdlib.ioloop import IOLoop
from pyftpdlib.log import config_logging
from pyftpdlib.servers import FTPServer


class TransferHandler(ThrottledDTPHandler):
    drop_scheduled = False

    def send(self, data):
        name = Path(self.file_obj.name).name if self.file_obj else ""
        self.write_limit = 65536 if name in ("slow-transfer.bin", "broken-transfer.bin") else 0
        sent = super().send(data)
        if name == "broken-transfer.bin" and self.tot_bytes_sent >= 65536 and not self.drop_scheduled:
            self.drop_scheduled = True
            self.ioloop.call_later(0.01, self.handle_close)
        return sent

    def recv(self, buffer_size):
        broken = self.file_obj and Path(self.file_obj.name).name == "broken-upload.bin"
        self.read_limit = 65536 if broken else 0
        chunk = super().recv(buffer_size)
        if broken and not self.drop_scheduled:
            self.drop_scheduled = True
            self.ioloop.call_later(0.01, self.cmd_channel.close)
        return chunk


class SecureTransferHandler(TransferHandler, TLS_DTPHandler):
    pass


class FTPFixture:
    def __init__(self, directory):
        root = directory / "ftp"
        root.mkdir()
        (root / "target.txt").write_text("target")
        (root / "relative-link").symlink_to("target.txt")
        (root / "broken-link").symlink_to("missing.txt")
        (root / ".hidden").write_text("hidden")
        (root / "empty").mkdir()
        (root / "slow-transfer.bin").write_bytes(bytes(range(256)) * 32768)
        (root / "broken-transfer.bin").write_bytes(bytes(range(256)) * 32768)
        authorizer = DummyAuthorizer()
        authorizer.add_user("fixture", "fixture-password", str(root), perm="elradfmwMT")
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Acode disposable FTP fixture")])
        now = datetime.now(timezone.utc)
        certificate = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                       .public_key(key.public_key()).serial_number(x509.random_serial_number())
                       .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=1))
                       .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
                       .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
                       .sign(key, hashes.SHA256()))
        certificate_path = directory / "ftp-certificate.pem"
        key_path = directory / "ftp-key.pem"
        certificate_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))

        class PlainHandler(FTPHandler):
            dtp_handler = TransferHandler

        class SecureHandler(TLS_FTPHandler):
            dtp_handler = SecureTransferHandler
            certfile = str(certificate_path)
            keyfile = str(key_path)
            tls_control_required = True
            tls_data_required = True

        class ImplicitHandler(SecureHandler):
            def handle(self):
                self.secure_connection(self.ssl_context)

            def handle_ssl_established(self):
                FTPHandler.handle(self)

        PlainHandler.authorizer = SecureHandler.authorizer = authorizer
        PlainHandler.auth_failed_timeout = SecureHandler.auth_failed_timeout = 0
        self.loop = IOLoop()
        self.plain = FTPServer(("127.0.0.1", 0), PlainHandler, ioloop=self.loop)
        self.secure = FTPServer(("127.0.0.1", 0), SecureHandler, ioloop=self.loop)
        self.implicit = FTPServer(("127.0.0.1", 0), ImplicitHandler, ioloop=self.loop)
        config_logging(level=logging.ERROR)
        self.config = {"ftpPort": self.plain.socket.getsockname()[1], "ftpsPort": self.secure.socket.getsockname()[1], "implicitFtpsPort": self.implicit.socket.getsockname()[1], "ftpCertificate": certificate_path.read_text()}
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while not self.stopped.is_set():
            self.loop.loop(timeout=0.1, blocking=False)

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=2)
        self.plain.close_all()
