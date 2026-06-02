declare module 'cordova/channel';
declare module 'cordova/exec';
interface Cordova {
    fireDocumentEvent(eventName: string, data?: any): void;
}
