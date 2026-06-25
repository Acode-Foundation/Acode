package com.silkimen.http;

import android.content.Context;
import android.security.KeyChain;

import java.net.Socket;
import java.security.Principal;
import java.security.PrivateKey;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;

import javax.net.ssl.X509ExtendedKeyManager;

public class KeyChainKeyManager extends X509ExtendedKeyManager {
  private final String alias;
  private final X509Certificate[] chain;
  private final PrivateKey key;

  public KeyChainKeyManager(String alias, PrivateKey key, X509Certificate[] chain) {
    this.alias = alias;
    this.key = key;
    this.chain = chain;
  }

  @Override
  public String chooseClientAlias(String[] keyTypes, Principal[] issuers, Socket socket) {
    return this.alias;
  }

  @Override
  public X509Certificate[] getCertificateChain(String alias) {
    return chain;
  }

  @Override
  public PrivateKey getPrivateKey(String alias) {
    return key;
  }

  @Override
  public final String chooseServerAlias(String keyType, Principal[] issuers, Socket socket) {
    // not a client SSLSocket callback
    throw new UnsupportedOperationException();
  }

  @Override
  public final String[] getClientAliases(String keyType, Principal[] issuers) {
    // not a client SSLSocket callback
    throw new UnsupportedOperationException();
  }

  @Override
  public final String[] getServerAliases(String keyType, Principal[] issuers) {
    // not a client SSLSocket callback
    throw new UnsupportedOperationException();
  }
}
