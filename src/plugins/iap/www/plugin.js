var  __iap_plugin_isIapAvailable = true;
module.exports = {
  getProducts: function (productIds, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Iap', 'getProducts', [productIds]);
  },
  setPurchaseUpdatedListener: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Iap', 'setPurchaseUpdatedListener', []);
  },
  startConnection: function (onSuccess, onFail) {
    cordova.exec(onSuccess, function (error) {
      onFail(error);
      __iap_plugin_isIapAvailable = error !== 3;
    }, 'Iap', 'startConnection', []);
  },
  consume: function (purchaseToken, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Iap', 'consume', [purchaseToken]);
  },
  purchase: function (productId, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Iap', 'purchase', [productId]);
  },
  getPurchases: function (onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Iap', 'getPurchases', []);
  },
  acknowledgePurchase: function (purchaseToken, onSuccess, onFail) {
    cordova.exec(onSuccess, onFail, 'Iap', 'acknowledgePurchase', [purchaseToken]);
  },
  isIapAvailable(){
    return __iap_plugin_isIapAvailable;
  },
  BILLING_UNAVAILABLE: 3,
  DEVELOPER_ERROR: 5,
  ERROR: 6,
  FEATURE_NOT_SUPPORTED: -2,
  ITEM_ALREADY_OWNED: 7,
  ITEM_NOT_OWNED: 8,
  ITEM_UNAVAILABLE: 4,
  OK: 0,
  SERVICE_DISCONNECTED: -1,
  SERVICE_TIMEOUT: -3,
  SERVICE_TIMEOUT: 2,
  USER_CANCELED: 1,
  PURCHASE_STATE_PURCHASED: 1,
  PURCHASE_STATE_PENDING: 2,
  PURCHASE_STATE_UNKNOWN: 0,
};