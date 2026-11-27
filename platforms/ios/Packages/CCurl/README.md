# Acode's iOS curl package

This local Swift package builds upstream curl's FTP/FTPS implementation. It shares
the exact OpenSSL 3.6.2 package used by libssh2; it does not bundle a second crypto
library. `Bridge/` only wraps C varargs and callback setters for Swift.

Source: <https://curl.se/download/curl-8.22.0.tar.xz>

SHA-256: `f7ef3ae8a22e521f289803fe93543eb64c329b58aa73a9e224dfd915a2a5f4f7`

`Vendor/curl/lib` and `Vendor/curl/include/curl` contain the release's `.c` and `.h`
files, retaining their upstream relative paths and contents. The sole added file
is `lib/curl_config.h`, containing the defined configuration macros for the
64-bit Apple ABI. `COPYING` is the upstream license, also copied into the app's
`FTP-Licenses.txt` resource. Upstream sources are intentionally kept together;
unselected protocols compile out through curl's feature guards.

## Configuration and updates

Use an extracted, checksum-verified release and an out-of-tree configure directory.
Point `--with-openssl` at a temporary prefix whose `include/` and `lib/` expose the
headers and libraries from the pinned OpenSSL simulator artifact. Configure with
the iOS simulator clang target (minimum deployment target 18.6):

```sh
CC='xcrun --sdk iphonesimulator clang' \
CFLAGS='-target arm64-apple-ios18.6-simulator' \
LDFLAGS='-target arm64-apple-ios18.6-simulator -framework Security -framework CoreFoundation' \
<curl-source>/configure \
  --host=aarch64-apple-darwin --build=aarch64-acode-darwin \
  --with-openssl=<temporary-openssl-prefix> --with-apple-sectrust \
  --enable-threaded-resolver --enable-ipv6 --enable-ftp \
  --disable-shared --enable-static \
  --without-libpsl --without-libidn2 --without-zlib --without-brotli --without-zstd \
  --without-nghttp2 --without-nghttp3 --without-libssh2 --without-ca-bundle --without-ca-path \
  --disable-http --disable-file --disable-ipfs --disable-ldap --disable-ldaps \
  --disable-rtsp --disable-proxy --disable-dict --disable-telnet --disable-tftp \
  --disable-pop3 --disable-imap --disable-smb --disable-smtp --disable-gopher \
  --disable-mqtt --disable-ntlm --disable-cookies --disable-manual --disable-libcurl-option
```

The package explicitly defines `USE_APPLE_SECTRUST`, equivalent to configure's
`--with-apple-sectrust` option. Keep defined macros from the generated
`lib/curl_config.h`, checking any conditional sections before compacting it.
SwiftPM supplies architecture and deployment flags for each actual build.

FTPS retains peer and hostname verification and uses Apple's trust store through
`CURLSSLOPT_NATIVE_CA`. Explicit TLS protects both control and data channels;
port 990 selects implicit TLS. The native test adapter can supply a disposable CA
blob without installing roots or changing the public JavaScript API.

When updating, verify the archive hash, replace upstream source/header files,
regenerate configuration, update the license resource, and run the FTP/FTPS
simulator fixtures plus a device build. Tests cover active/passive binary
transfers, directory operations, command replies, TLS rejection and cancellation.
