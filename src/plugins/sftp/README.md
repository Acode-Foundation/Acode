# cordova-plugin-sftp

SFTP and SSH client for Cordova on Android.

## Features

- Encrypted connection profiles, held in native storage; credentials never reach
  the WebView's local storage.
- Host key verification on first connection, with a prompt in the app rather than
  a platform dialog, and a prompt before a changed key is accepted.
- Directory listing, stat, create, rename, delete and recursive delete.
- File upload and download.
- Interactive SSH shells, streamed to the page.
- One operation at a time on the connection, which the SSH client requires.

## Installation

```sh
cordova plugin add cordova-plugin-sftp
cordova prepare
```

During development, link the plugin instead of copying it, so native edits are
picked up by a rebuild without reinstalling:

```sh
cordova plugin add ../path/to/sftp --link
```

The link is lost if the platform is re-added or the project is restored with
`cordova prepare`; re-add the plugin to restore it.

## Usage

The JavaScript API accepts callbacks, which the app uses, or promises:

```js
const home = await sftp.testProfile(profileId, requestId, 15000);

sftp.lsDir("/home/user", (entries) => {
  console.log(entries);
}, console.error);
```

## Host key confirmation

The plugin asks the page before trusting an unknown host or accepting a key that
changed. It calls `window.__acodeSftpConfirm(request)` and waits for the answer,
which the page sends back with `sftp.resolveConfirmation(id, confirmed)`. If the
page is gone, the wait times out and the connection is refused.

## Layout

| File | Responsibility |
| --- | --- |
| `SftpPlugin.java` | Cordova entry point and action table |
| `SftpSession.java` | The live connection and its SFTP subsystem |
| `SftpOperationQueue.java` | Serialises client access |
| `HostKeyVerifier.java` | Trust on first use, and changed-key handling |
| `WebConfirm.java` | Native-to-page confirmation bridge |
| `SftpSecurityStore.java` | Encrypted profiles and trusted hosts |
| `Transfer.java` | Local/remote file transfer |
| `RemoteShell.java` | Interactive SSH shell |
| `Metadata.java` | Server attributes to page JSON |
