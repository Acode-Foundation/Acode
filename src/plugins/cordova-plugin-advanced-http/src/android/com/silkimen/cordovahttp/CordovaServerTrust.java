package com.silkimen.cordovahttp;

import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;

import com.silkimen.http.TLSConfiguration;

import org.apache.cordova.CallbackContext;

import android.app.Activity;
import android.util.Log;
import android.content.res.AssetManager;

import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.SSLSession;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

class CordovaServerTrust implements Runnable {
  private static final String TAG = "Cordova-Plugin-HTTP";

  private final TrustManager[] noOpTrustManagers;
  private final HostnameVerifier noOpVerifier;

  private String mode;
  private Activity activity;
  private TLSConfiguration tlsConfiguration;
  private CallbackContext callbackContext;

  public CordovaServerTrust(final String mode, final Activity activity, final TLSConfiguration configContainer,
      final CallbackContext callbackContext) {

    this.mode = mode;
    this.activity = activity;
    this.tlsConfiguration = configContainer;
    this.callbackContext = callbackContext;

    this.noOpTrustManagers = new TrustManager[] { new X509TrustManager() {
      public X509Certificate[] getAcceptedIssuers() {
        return new X509Certificate[0];
      }

      public void checkClientTrusted(X509Certificate[] chain, String authType) {
        // intentionally left blank
      }

      public void checkServerTrusted(X509Certificate[] chain, String authType) {
        // intentionally left blank
      }
    } };

    this.noOpVerifier = new HostnameVerifier() {
      public boolean verify(String hostname, SSLSession session) {
        return true;
      }
    };
  }

  @Override
  public void run() {
    try {
      if ("legacy".equals(this.mode)) {
        this.tlsConfiguration.setHostnameVerifier(null);
        this.tlsConfiguration.setTrustManagers(null);
      } else if ("nocheck".equals(this.mode)) {
        this.tlsConfiguration.setHostnameVerifier(this.noOpVerifier);
        this.tlsConfiguration.setTrustManagers(this.noOpTrustManagers);
      } else if ("pinned".equals(this.mode)) {
        this.tlsConfiguration.setHostnameVerifier(null);
        this.tlsConfiguration.setTrustManagers(this.getTrustManagers(this.getCertsFromBundle("www/certificates")));
      } else {
        this.tlsConfiguration.setHostnameVerifier(null);
        this.tlsConfiguration.setTrustManagers(this.getTrustManagers(this.getCertsFromKeyStore("AndroidCAStore")));
      }

      callbackContext.success();
    } catch (Exception e) {
      Log.e(TAG, "An error occured while configuring SSL cert mode", e);
      callbackContext.error("An error occured while configuring SSL cert mode");
    }
  }

  private TrustManager[] getTrustManagers(KeyStore store) throws GeneralSecurityException {
    String tmfAlgorithm = TrustManagerFactory.getDefaultAlgorithm();
    TrustManagerFactory tmf = TrustManagerFactory.getInstance(tmfAlgorithm);
    tmf.init(store);

    return tmf.getTrustManagers();
  }

  private KeyStore getCertsFromBundle(String path) throws GeneralSecurityException, IOException {
    AssetManager assetManager = this.activity.getAssets();
    String[] files = assetManager.list(path);

    CertificateFactory cf = CertificateFactory.getInstance("X.509");
    String keyStoreType = KeyStore.getDefaultType();
    KeyStore keyStore = KeyStore.getInstance(keyStoreType);

    keyStore.load(null, null);

    for (int i = 0; i < files.length; i++) {
      int index = files[i].lastIndexOf('.');

      if (index == -1 || !files[i].substring(index).equals(".cer")) {
        continue;
      }

      keyStore.setCertificateEntry("CA" + i, cf.generateCertificate(assetManager.open(path + "/" + files[i])));
    }

    return keyStore;
  }

  private KeyStore getCertsFromKeyStore(String storeType) throws GeneralSecurityException, IOException {
    KeyStore store = KeyStore.getInstance(storeType);
    store.load(null);

    return store;
  }
}
