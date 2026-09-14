# Custom-tab Save and Save As

Custom tabs use Acode's standard Save controls through the `EditorFile` save event. The plugin owns serialization, destination dialogs, writing and dirty tracking.

```js
if (typeof tab.canSave === "boolean") {
  const onSave = (event) => {
    event.respondWith(saveDocument(event.saveAs));
  };
  tab.on("save", onSave);
  // On plugin disposal:
  // tab.off("save", onSave);
}
```

`tab.canSave` is read-only: open text-editor tabs qualify automatically; custom tabs need a `save` listener or `onsave` handler. Removing the handler or closing the custom tab disables saving. The handler must implement saving and guard loading, protection and processing.

The event retains `target`, `preventDefault()` and `stopPropagation()`. It additionally exposes:

- `saveAs`: `false` for `tab.save()`, `true` for `tab.saveAs()`.
- `respondWith(Promise<boolean>)`: call synchronously, once, during dispatch to suppress default saving. Resolve `true` after a successful write, `false` for cancellation or no save, and reject for failure. Calling after an `await` or responding twice throws.

Other observers can still see the event. Existing `preventDefault()` cancellation remains supported. Unhandled text saves use the normal text writer; unhandled custom-tab saves return `false`.

Concurrent requests on one custom tab share its pending promise; the first request determines Save versus Save As. Different tabs are independent. Invoke the plugin's writer directly to avoid recursive save dispatch. Remove the listener on unload and cancel pending work on tab close; closed tabs cannot publish completion notifications.

Before resolving success, update the destination and acknowledge only the written revision; newer edits must remain dirty. Acode then emits `save-file` and update notifications. Save All runs sequentially; save-and-close stops after cancellation, failure or remaining edits. Text encoding, format-on-save and autosave retain their existing behavior.

Feature-detect `tab.canSave`. Older hosts require the plugin's own fallback and commands; their built-in Save menu does not support custom tabs.
