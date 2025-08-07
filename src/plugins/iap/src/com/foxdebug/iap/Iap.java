package com.foxdebug.iap;

import android.app.Activity;
import android.content.Context;
import android.util.Log;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.AcknowledgePurchaseResponseListener;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClient.BillingResponseCode;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ConsumeParams;
import com.android.billingclient.api.ConsumeResponseListener;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.ProductDetailsResponseListener;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesResponseListener;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryProductDetailsResult;
import com.android.billingclient.api.QueryPurchasesParams;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaInterface;
import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.PluginResult;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class Iap extends CordovaPlugin {

  private BillingClient billingClient;
  private WeakReference<Context> contextRef;
  private WeakReference<Activity> activityRef;
  private CallbackContext purchaseUpdated;

  public void initialize(CordovaInterface cordova, CordovaWebView webView) {
    super.initialize(cordova, webView);
    contextRef = new WeakReference<>(cordova.getContext());
    activityRef = new WeakReference<>(cordova.getActivity());
    billingClient = getBillingClient();
  }

  @Override
  public boolean execute(
    String action,
    JSONArray args,
    CallbackContext callbackContext
  ) throws JSONException {
    String arg1 = getString(args, 0);
    switch (action) {
      case "startConnection":
      case "getProducts":
      case "setPurchaseUpdatedListener":
      case "purchase":
      case "consume":
      case "getPurchases":
      case "acknowledgePurchase":
        break;
      default:
        return false;
    }

    cordova
      .getThreadPool()
      .execute(
        new Runnable() {
          public void run() {
            switch (action) {
              case "startConnection":
                startConnection(callbackContext);
                break;
              case "getProducts":
                getProducts(getStringList(args, 0), callbackContext);
                break;
              case "setPurchaseUpdatedListener":
                setPurchaseUpdatedListener(callbackContext);
                break;
              case "purchase":
                purchase(arg1, callbackContext);
                break;
              case "consume":
                consume(arg1, callbackContext);
                break;
              case "getPurchases":
                getPurchases(callbackContext);
                break;
              case "acknowledgePurchase":
                acknowledgePurchase(arg1, callbackContext);
                break;
            }
          }
        }
      );

    return true;
  }

  private BillingClient getBillingClient() {
    return BillingClient.newBuilder(this.contextRef.get())
      .enablePendingPurchases(
        PendingPurchasesParams.newBuilder().enableOneTimeProducts().build()
      )
      .setListener(
        new PurchasesUpdatedListener() {
          public void onPurchasesUpdated(
            BillingResult billingResult,
            List<Purchase> purchases
          ) {
            try {
              int responseCode = billingResult.getResponseCode();
              if (responseCode == BillingResponseCode.OK) {
                JSONArray result = new JSONArray();
                for (Purchase purchase : purchases) {
                  result.put(purchaseToJson(purchase));
                }
                sendPurchasePluginResult(
                  new PluginResult(PluginResult.Status.OK, result)
                );
              } else {
                sendPurchasePluginResult(
                  new PluginResult(PluginResult.Status.ERROR, responseCode)
                );
              }
            } catch (JSONException e) {
              sendPurchasePluginResult(
                new PluginResult(PluginResult.Status.ERROR, e.getMessage())
              );
            }
          }
        }
      )
      .build();
  }

  private void setPurchaseUpdatedListener(CallbackContext callbackContext) {
    purchaseUpdated = callbackContext;
  }

  private void consume(String token, CallbackContext callbackContext) {
    ConsumeParams consumeParams = ConsumeParams.newBuilder()
      .setPurchaseToken(token)
      .build();
    billingClient.consumeAsync(
      consumeParams,
      new ConsumeResponseListener() {
        public void onConsumeResponse(
          BillingResult billingResult,
          String purchaseToken
        ) {
          int responseCode = billingResult.getResponseCode();
          if (responseCode == BillingResponseCode.OK) {
            callbackContext.success(responseCode);
          } else {
            callbackContext.error(responseCode);
          }
        }
      }
    );
  }

  private void startConnection(CallbackContext callbackContext) {
    try {
      if (billingClient == null) {
        billingClient = getBillingClient();
      }
      billingClient.startConnection(
        new BillingClientStateListener() {
          public void onBillingSetupFinished(BillingResult billingResult) {
            int responseCode = billingResult.getResponseCode();
            if (responseCode == BillingResponseCode.OK) {
              callbackContext.success(responseCode);
            } else {
              callbackContext.error(responseCode);
            }
          }

          public void onBillingServiceDisconnected() {
            callbackContext.error("Billing service disconnected");
          }
        }
      );
    } catch (SecurityException e) {
      callbackContext.error(e.getMessage());
    }
  }

  private void getProducts(
    List<String> idList,
    CallbackContext callbackContext
  ) {
    if (billingClient == null) {
      billingClient = getBillingClient();
      callbackContext.error("Billing client is not connected");
      return;
    }
    List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
    for (String productId : idList) {
      productList.add(
        QueryProductDetailsParams.Product.newBuilder()
          .setProductId(productId)
          .setProductType(BillingClient.ProductType.INAPP)
          .build()
      );
    }
    QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
      .setProductList(productList)
      .build();

    billingClient.queryProductDetailsAsync(
      params,
      new ProductDetailsResponseListener() {
        public void onProductDetailsResponse(
          BillingResult billingResult,
          QueryProductDetailsResult queryProductDetailsResult
        ) {
          try {
            int responseCode = billingResult.getResponseCode();
            if (responseCode == BillingResponseCode.OK) {
              List<ProductDetails> productDetailsList = queryProductDetailsResult.getProductDetailsList();
              JSONArray products = new JSONArray();
              for (ProductDetails productDetails : productDetailsList) {
                JSONObject product = new JSONObject();
                ProductDetails.OneTimePurchaseOfferDetails offerDetails = productDetails.getOneTimePurchaseOfferDetails();
                if (offerDetails != null) {
                  product.put("productId", productDetails.getProductId());
                  product.put("title", productDetails.getTitle());
                  product.put("description", productDetails.getDescription());
                  product.put("price", offerDetails.getFormattedPrice());
                  product.put(
                    "priceAmountMicros",
                    offerDetails.getPriceAmountMicros()
                  );
                  product.put(
                    "priceCurrencyCode",
                    offerDetails.getPriceCurrencyCode()
                  );
                  product.put("type", productDetails.getProductType());
                }
                products.put(product);
              }
              callbackContext.success(products);
            } else {
              callbackContext.error(responseCode);
            }
          } catch (JSONException e) {
            callbackContext.error(e.getMessage());
          }
        }
      }
    );
  }

  private void purchase(String productIdOrJson, CallbackContext callbackContext) {
    try {
      if (productIdOrJson == null || productIdOrJson.trim().isEmpty()) {
        callbackContext.error("Product ID cannot be null or empty");
        return;
      }
      
      final String productId = productIdOrJson;
      
      List<QueryProductDetailsParams.Product> productList = new ArrayList<>();
      productList.add(
        QueryProductDetailsParams.Product.newBuilder()
          .setProductId(productId)
          .setProductType(BillingClient.ProductType.INAPP)
          .build()
      );
      QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
        .setProductList(productList)
        .build();
        
      billingClient.queryProductDetailsAsync(
        params,
        new ProductDetailsResponseListener() {
          public void onProductDetailsResponse(
            BillingResult billingResult,
            QueryProductDetailsResult queryProductDetailsResult
          ) {
            if (billingResult.getResponseCode() == BillingResponseCode.OK) {
              List<ProductDetails> productDetailsList = queryProductDetailsResult.getProductDetailsList();
              if (!productDetailsList.isEmpty()) {
                ProductDetails productDetails = productDetailsList.get(0);
                BillingResult result = billingClient.launchBillingFlow(
                  activityRef.get(),
                  BillingFlowParams.newBuilder().setProductDetailsParamsList(
                    Arrays.asList(
                      BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .build()
                    )
                  ).build()
                );
                int responseCode = result.getResponseCode();
                if (responseCode == BillingResponseCode.OK) {
                  callbackContext.success();
                } else {
                  callbackContext.error(responseCode);
                }
              } else {
                callbackContext.error("No product details found for: " + productId);
              }
            } else {
              callbackContext.error(billingResult.getResponseCode());
            }
          }
        }
      );
    } catch (Exception e) {
      callbackContext.error("Purchase error: " + e.getMessage());
    }
  }

  private void getPurchases(CallbackContext callbackContext) {
    if (billingClient == null) {
      billingClient = getBillingClient();
      callbackContext.error("Billing client is not connected");
      return;
    }

    QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
      .setProductType(BillingClient.ProductType.INAPP)
      .build();
    billingClient.queryPurchasesAsync(
      params,
      new PurchasesResponseListener() {
        public void onQueryPurchasesResponse(
          BillingResult billingResult,
          List<Purchase> purchasesList
        ) {
          try {
            int responseCode = billingResult.getResponseCode();
            if (responseCode == BillingResponseCode.OK) {
              JSONArray purchases = new JSONArray();
              for (Purchase purchase : purchasesList) {
                purchases.put(purchaseToJson(purchase));
              }
              callbackContext.success(purchases);
            } else {
              callbackContext.error(responseCode);
            }
          } catch (JSONException e) {
            callbackContext.error(e.getMessage());
          }
        }
      }
    );
  }

  private void acknowledgePurchase(
    String purchaseToken,
    CallbackContext callbackContext
  ) {
    if (billingClient == null) {
      billingClient = getBillingClient();
      callbackContext.error("Billing client is not connected");
      return;
    }

    AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
      .setPurchaseToken(purchaseToken)
      .build();

    billingClient.acknowledgePurchase(
      params,
      new AcknowledgePurchaseResponseListener() {
        public void onAcknowledgePurchaseResponse(BillingResult billingResult) {
          int responseCode = billingResult.getResponseCode();
          if (responseCode == BillingResponseCode.OK) {
            callbackContext.success();
          } else {
            callbackContext.error(responseCode);
          }
        }
      }
    );
  }

  private JSONObject purchaseToJson(Purchase purchase) throws JSONException {
    JSONObject item = new JSONObject();
    List<String> skuList = purchase.getSkus();
    JSONArray skuArray = new JSONArray();
    for (String sku : skuList) {
      skuArray.put(sku);
    }
    item.put("productIds", skuArray);
    item.put("orderId", purchase.getOrderId());
    item.put("signature", purchase.getSignature());
    item.put("purchaseTime", purchase.getPurchaseTime());
    item.put("purchaseToken", purchase.getPurchaseToken());
    item.put("purchaseState", purchase.getPurchaseState());
    item.put("isAcknowledged", purchase.isAcknowledged());
    item.put("developerPayload", purchase.getDeveloperPayload());
    return item;
  }

  private void sendPurchasePluginResult(PluginResult result) {
    if (purchaseUpdated != null) {
      result.setKeepCallback(true);
      purchaseUpdated.sendPluginResult(result);
    }
  }

  private String getString(JSONArray args, int index) {
    try {
      return args.getString(index);
    } catch (JSONException e) {
      return null;
    }
  }

  private List<String> getStringList(JSONArray args, int index) {
    try {
      JSONArray array = args.getJSONArray(index);
      List<String> list = new ArrayList<String>();
      for (int i = 0; i < array.length(); i++) {
        list.add(array.getString(i));
      }
      return list;
    } catch (JSONException e) {
      return null;
    }
  }
}
