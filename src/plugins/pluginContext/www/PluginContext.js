var exec = require("cordova/exec");

const PluginContext = (function () {
  const _state = new WeakMap();

  class _PluginContext {
    time = Date.now();
    constructor(pluginId, uuid) {
      _state.set(this, { pluginId, uuid });
      Object.freeze(this);
    }
    grantedPermission(permission) {
      const state = _state.get(this);
      return new Promise((resolve, reject) => {
        exec(resolve, reject, "Tee", "grantedPermission", [
          state.uuid,
          permission,
        ]);
      });
    }

    listAllPermissions() {
      const state = _state.get(this);
      return new Promise((resolve, reject) => {
        exec(resolve, reject, "Tee", "listAllPermissions", [state.uuid]);
      });
    }
  }

  //Object.freeze(this);

  return {
    generate: async function (pluginId, pluginJson) {
      try {
        function requestToken(pluginId) {
          return new Promise((resolve, reject) => {
            exec(resolve, reject, "Tee", "requestToken", [
              pluginId,
              pluginJson,
            ]);
          });
        }

        const uuid = await requestToken(pluginId);
        return new _PluginContext(pluginId, uuid);
      } catch (err) {
        console.warn(
          `PluginContext generation failed for pluginId ${pluginId}:`,
        );
        return null;
      }
    },
  };
})();

module.exports = PluginContext;
