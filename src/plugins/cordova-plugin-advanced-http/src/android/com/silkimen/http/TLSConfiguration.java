package com.silkimen.http;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.KeyManager;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;

import com.silkimen.http.TLSSocketFactory;

public class TLSConfiguration {
  private TrustManager[] trustManagers = null;
  private KeyManager[] keyManagers = null;
  private HostnameVerifier hostnameVerifier = null;
  private String[] blacklistedProtocols = {};

  private SSLSocketFactory socketFactory;

  public void setHostnameVerifier(HostnameVerifier hostnameVerifier) {
    this.hostnameVerifier = hostnameVerifier;
  }

  public void setKeyManagers(KeyManager[] keyManagers) {
    this.keyManagers = keyManagers;
    this.socketFactory = null;
  }

  public void setTrustManagers(TrustManager[] trustManagers) {
    this.trustManagers = trustManagers;
    this.socketFactory = null;
  }

  public void setBlacklistedProtocols(String[] protocols) {
    this.blacklistedProtocols = protocols;
    this.socketFactory = null;
  }

  public HostnameVerifier getHostnameVerifier() {
    return this.hostnameVerifier;
  }

  public SSLSocketFactory getTLSSocketFactory() throws IOException {
    if (this.socketFactory != null) {
      return this.socketFactory;
    }

    try {
      SSLContext context = SSLContext.getInstance("TLS");

      context.init(this.keyManagers, this.trustManagers, new SecureRandom());
      this.socketFactory = new TLSSocketFactory(context, this.blacklistedProtocols);

      return this.socketFactory;
    } catch (GeneralSecurityException e) {
      IOException ioException = new IOException("Security exception occured while configuring TLS context");
      ioException.initCause(e);
      throw ioException;
    }
  }
}
