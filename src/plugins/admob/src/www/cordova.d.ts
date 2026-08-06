interface Cordova {
  fireDocumentEvent(eventName: string, data?: unknown): void;
}

declare module "cordova/channel" {
  interface CordovaChannel {
    createSticky(name: string): void;
    initializationComplete(name: string): void;
    onCordovaReady: {
      subscribe(listener: () => void): void;
    };
    waitForInitialization(name: string): void;
  }

  const channel: CordovaChannel;
  export default channel;
}

declare module "cordova/exec" {
  type Callback = (value: unknown) => unknown;

  function exec(
    success: Callback,
    fail: Callback,
    service: string,
    action: string,
    args?: unknown[],
  ): void;

  export default exec;
}
