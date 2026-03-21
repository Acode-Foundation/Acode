var exec = require("cordova/exec");

const PluginContext = (function () {
  //=============================
  class _PluginContext {
    constructor(uuid) {
      this.created_at = Date.now();
      this.uuid = uuid;
      Object.freeze(this);
    }

    toString() {
      return this.uuid;
    }

    [Symbol.toPrimitive](hint) {
      if (hint === "number") {
        return NaN; // prevent numeric coercion
      }
      return this.uuid;
    }

    grantedPermission(permission) {
      return new Promise((resolve, reject) => {
        exec(resolve, reject, "Tee", "grantedPermission", [
          this.uuid,
          permission,
        ]);
      });
    }

    listAllPermissions() {
      return new Promise((resolve, reject) => {
        exec(resolve, reject, "Tee", "listAllPermissions", [this.uuid]);
      });
    }

    getSecret(key, defaultValue = "") {
      return new Promise((resolve, reject) => {
        exec(
          resolve,
          reject,
          "Tee",             
          "get_secret",       
          [this.uuid, key, defaultValue]
        );
      });
    }


    setSecret(key, value) {
      return new Promise((resolve, reject) => {
        exec(
          resolve,
          reject,
          "Tee",
          "set_secret",
          [this.uuid, key, value]
        );
      });
    }
  }

  //Object.freeze(this);

  //===============================

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
        return new _PluginContext(uuid);
      } catch (err) {
        console.warn(`PluginContext creation failed for pluginId ${pluginId}:`, err);
        return null;
      }
    },
  };
})();

module.exports = PluginContext;
