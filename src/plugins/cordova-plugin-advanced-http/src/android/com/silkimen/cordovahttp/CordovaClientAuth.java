package com.silkimen.cordovahttp;

import android.app.Activity;
import android.content.Context;
import android.security.KeyChain;
import android.security.KeyChainAliasCallback;
import android.util.Log;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.URI;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;

import javax.net.ssl.KeyManager;
import javax.net.ssl.KeyManagerFactory;

import org.apache.cordova.CallbackContext;

import com.silkimen.http.KeyChainKeyManager;
import com.silkimen.http.TLSConfiguration;

class CordovaClientAuth implements Runnable, KeyChainAliasCallback {
  private static final String TAG = "Cordova-Plugin-HTTP";

  private String mode;
  private String aliasString;
  private byte[] rawPkcs;
  private String pkcsPassword;
  private Activity activity;
  private Context context;
  private TLSConfiguration tlsConfiguration;
  private CallbackContext callbackContext;

  public CordovaClientAuth(final String mode, final String aliasString, final byte[] rawPkcs,
      final String pkcsPassword, final Activity activity, final Context context, final TLSConfiguration configContainer,
      final CallbackContext callbackContext) {

    this.mode = mode;
    this.aliasString = aliasString;
    this.rawPkcs = rawPkcs;
    this.pkcsPassword = pkcsPassword;
    this.activity = activity;
    this.tlsConfiguration = configContainer;
    this.context = context;
    this.callbackContext = callbackContext;
  }

  @Override
  public void run() {
    if ("systemstore".equals(this.mode)) {
      this.loadFromSystemStore();
    } else if ("buffer".equals(this.mode)) {
      this.loadFromBuffer();
    } else {
      this.disableClientAuth();
    }
  }

  private void loadFromSystemStore() {
    if (this.aliasString == null) {
      KeyChain.choosePrivateKeyAlias(this.activity, this, null, null, null, -1, null);
    } else {
      this.alias(this.aliasString);
    }
  }

  private void loadFromBuffer() {
    try {
      KeyStore keyStore = KeyStore.getInstance("PKCS12");
      String keyManagerFactoryAlgorithm = KeyManagerFactory.getDefaultAlgorithm();
      KeyManagerFactory keyManagerFactory = KeyManagerFactory.getInstance(keyManagerFactoryAlgorithm);
      ByteArrayInputStream stream = new ByteArrayInputStream(this.rawPkcs);

      keyStore.load(stream, this.pkcsPassword.toCharArray());
      keyManagerFactory.init(keyStore, this.pkcsPassword.toCharArray());

      this.tlsConfiguration.setKeyManagers(keyManagerFactory.getKeyManagers());
      this.callbackContext.success();
    } catch (Exception e) {
      Log.e(TAG, "Couldn't load given PKCS12 container for authentication", e);
      this.callbackContext.error("Couldn't load given PKCS12 container for authentication");
    }
  }

  private void disableClientAuth() {
    this.tlsConfiguration.setKeyManagers(null);
    this.callbackContext.success();
  }

  @Override
  public void alias(final String alias) {
    try {
      if (alias == null) {
        throw new Exception("Couldn't get a consent for private key access");
      }

      PrivateKey key = KeyChain.getPrivateKey(this.context, alias);
      X509Certificate[] chain = KeyChain.getCertificateChain(this.context, alias);
      KeyManager keyManager = new KeyChainKeyManager(alias, key, chain);

      this.tlsConfiguration.setKeyManagers(new KeyManager[] { keyManager });

      this.callbackContext.success(alias);
    } catch (Exception e) {
      Log.e(TAG, "Couldn't load private key and certificate pair with given alias \"" + alias + "\" for authentication",
          e);
      this.callbackContext.error(
          "Couldn't load private key and certificate pair with given alias \"" + alias + "\" for authentication");
    }
  }
}
