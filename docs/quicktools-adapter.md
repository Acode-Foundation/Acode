# Custom editor quicktools API

`acode.registerQuickToolsAdapter(tab, adapter)` connects stock quicktools to one custom `EditorFile`. Register when the editor is ready. Feature-detect the API and use `hideQuickTools: true` while loading, unsupported or on older hosts. Registration allows one adapter per tab and returns an idempotent cleanup function; call it on plugin unload. Tab closure also unregisters the adapter.

```js
const unregister = acode.registerQuickToolsAdapter?.(tab, {
  getState: () => ({ enabled: editor.writable, busy: editor.saving }),
  canHandle: action => editor.supports(action),
  subscribe: listener => editor.subscribe(listener), // returns unsubscribe
  captureSelection: () => editor.captureSelection(),
  restoreSelection: selection => editor.restoreSelection(selection),
  execute: (action, { signal }) => editor.execute(action, signal),
  focus: () => editor.focus(),
  cancel: () => editor.cancelPendingInput(), // optional
  onError: error => reportError(error), // optional
});
```

The example `editor` is plugin-owned. `getState`, `canHandle`, `subscribe` and `execute` are required; the other callbacks are optional. State and support queries must be synchronous, cheap and side-effect free. Execution, selection and focus callbacks may return promises. Notify subscribers when writability, processing, history or supported operations change; report plugin-owned dialogs as busy.

- `enabled` controls visibility while respecting the user's quicktools preferences. `busy` blocks editing without changing the layout; the command palette stays available.
- `canHandle(action)` guards execution and Undo/Redo availability. Return `false` for unsupported operations; they never fall through to another editor.
- `execute` receives `{ type: 'text', text }`, `{ type: 'key', key, ctrlKey, shiftKey, altKey, metaKey }`, or `{ type: 'command', command }`. Keys use `KeyboardEvent.key` names, but editors must implement browser-default movement and deletion through their own APIs.
- Command names include `undo`, `redo`, `saveFile`, `find`, `selectall`, `paste`, `movelinesup`, `movelinesdown`, `copylinesup` and `copylinesdown`.
- Modifier button availability is queried as `{ type: 'modifier', key: 'ctrl' | 'shift' | 'alt' | 'meta' }`. Acode combines captured keyboard input with modifiers; adapters do not execute modifier toggles.
- For supported paste operations, Acode reads native clipboard text and delivers a text action.

Acode captures selection before quicktools take focus and serializes input. Restore snapshots only for the current document revision. Restore focus only for explicit editing input; registration, selection restoration and dialogs must not force the keyboard open.

Tab changes, native overlays, disabled/busy state and disposal abort the execution signal and cancel modifiers, repeats and queued input. Check the signal and your session/revision after asynchronous work. `cancel` must not synchronously emit another state update. Leave Back handling and the action stack to Acode; keep stock quicktools items, gestures and preferences intact.
