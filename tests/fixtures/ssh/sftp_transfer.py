"""Terminate disposable SSH transports after transferring a real file prefix."""
import time

import paramiko


class BrokenTransferHandle(paramiko.SFTPHandle):
    def __init__(self, flags, disconnect):
        super().__init__(flags)
        self.disconnect = disconnect
        self.limit = 65536

    def read(self, offset, length):
        time.sleep(0.05)
        if offset >= self.limit:
            self.disconnect()
            return paramiko.SFTP_FAILURE
        return super().read(offset, min(length, self.limit - offset))

    def write(self, offset, data):
        if offset >= self.limit:
            self.disconnect()
            return paramiko.SFTP_FAILURE
        return super().write(offset, data)
