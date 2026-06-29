package com.silkimen.cordovahttp;

import org.apache.cordova.CallbackContext;
import org.json.JSONObject;

import java.util.Observer;

public class CordovaObservableCallbackContext {

    private CallbackContext callbackContext;
    private Integer requestId;
    private Observer observer;

    public CordovaObservableCallbackContext(CallbackContext callbackContext, Integer requestId) {
        this.callbackContext = callbackContext;
        this.requestId = requestId;
    }

    public void success(JSONObject message) {
        this.callbackContext.success(message);
        this.notifyObserver();
    }

    public void error(JSONObject message) {
        this.callbackContext.error(message);
        this.notifyObserver();
    }

    public Integer getRequestId() {
        return this.requestId;
    }

    public CallbackContext getCallbackContext() {
        return callbackContext;
    }

    public Observer getObserver() {
        return observer;
    }

    protected void notifyObserver() {
        if(this.observer != null){
            this.observer.update(null, this);
        }
    }

    /**
     * Set an observer that is notified, when {@link #success(JSONObject)}
     * or {@link #error(JSONObject)} are called.
     *
     * NOTE the observer is notified with
     * <pre>observer.update(null, cordovaObservableCallbackContext)</pre>
     * @param observer
     */
    public void setObserver(Observer observer) {
        this.observer = observer;
    }
}
