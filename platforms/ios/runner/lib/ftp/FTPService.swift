import Foundation

final class FTPService: BaseService {
    private let control = DispatchQueue(label: "app.acode.ftp.control")
    private var clients: [String: FTPClient] = [:]

    override func exec(action: String, args: [Any], callback: Callback) {
        control.async {
            do {
                if action == "connect" { try self.connect(args, callback: callback); return }
                let id = args[safe: 0] as? String ?? ""
                if action == "disconnect" {
                    let client = self.clients.removeValue(forKey: id)
                    client?.cancellation.cancel()
                    if let client { client.queue.async { callback.success() } } else { callback.success() }
                    return
                }
                guard let client = self.clients[id] else { throw FTPFailure("FTP client not found.") }
                client.queue.async {
                    do { try self.perform(action, args: args, client: client, callback: callback) }
                    catch { callback.error(error.localizedDescription) }
                }
            } catch { callback.error(error.localizedDescription) }
        }
    }

    override func reset() {
        control.async {
            for client in self.clients.values { client.cancellation.cancel() }
            self.clients.removeAll()
        }
    }

    private func connect(_ args: [Any], callback: Callback) throws {
        let profile = try FTPProfile(args)
        let client: FTPClient
        if let existing = clients[profile.id], existing.profile == profile, !existing.cancellation.cancelled { client = existing }
        else {
            client = try FTPClient(profile)
            clients.removeValue(forKey: profile.id)?.cancellation.cancel()
            clients[profile.id] = client
        }
        client.queue.async {
            do { try client.connect(); callback.success(profile.id) }
            catch {
                self.control.async { if self.clients[profile.id] === client { self.clients.removeValue(forKey: profile.id) } }
                callback.error(error.localizedDescription)
            }
        }
    }

    private func perform(_ action: String, args: [Any], client: FTPClient, callback: Callback) throws {
        let value = args[safe: 1] as? String ?? ""
        if action == "isConnected" {
            callback.success((try? client.command("NOOP")) != nil ? 1 : 0)
            return
        }
        try client.cancellation.check()
        if ["downloadFile", "uploadFile", "createFile", "createDirectory", "deleteFile", "deleteDirectory", "rename", "changeDirectory", "getStat"].contains(action), value.isEmpty {
            throw FTPFailure("Path is required.")
        }
        switch action {
        case "listDirectory": callback.success(try client.list(value))
        case "getStat": callback.success(try client.stat(value).json(path: client.path(value)))
        case "exists":
            do { _ = try client.stat(value); callback.success(1) }
            catch let error as FTPFailure where error.replyCode == 550 { callback.success(0) }
        case "downloadFile": try client.download(value, to: args[safe: 2] as? String ?? ""); callback.success()
        case "uploadFile": try client.upload(value, to: args[safe: 2] as? String ?? ""); callback.success()
        case "createFile": try client.perform(client.path(value), upload: true); callback.success()
        case "createDirectory": try client.command("MKD " + client.path(value)); callback.success()
        case "deleteFile": try client.command("DELE " + client.path(value)); callback.success()
        case "deleteDirectory": try client.removeDirectory(value); callback.success()
        case "rename": try client.rename(value, to: args[safe: 2] as? String ?? ""); callback.success(args[safe: 2])
        case "changeDirectory": try client.command("CWD " + client.path(value)); callback.success()
        case "changeToParentDirectory": try client.command("CDUP"); callback.success()
        case "getWorkingDirectory": callback.success(client.directory)
        case "getKeepAlive": callback.success(300)
        case "sendNoOp": try client.command("NOOP"); callback.success()
        case "execCommand": callback.success(try client.command(value, allowFailure: true))
        default: throw FTPFailure("FTP action is not available: " + action)
        }
    }
}
