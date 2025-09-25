/**
 * @module Executor
 * @description
 * This module provides an interface to run shell commands from a Cordova app.
 * It supports real-time process streaming, writing input to running processes,
 * stopping them, and executing one-time commands.
 */

const exec = require('cordova/exec');

const Executor = {
  /**
   * Starts a shell process and enables real-time streaming of stdout, stderr, and exit status.
   *
   * @param {string} command - The shell command to run (e.g., `"sh"`, `"ls -al"`).
   * @param {(type: 'stdout' | 'stderr' | 'exit', data: string) => void} onData - Callback that receives real-time output:
   *   - `"stdout"`: Standard output line.
   *   - `"stderr"`: Standard error line.
   *   - `"exit"`: Exit code of the process.
   * @param {boolean} alpine - Whether to run the command inside the Alpine sandbox environment (`true`) or on Android directly (`false`).
   * @returns {Promise<string>} Resolves with a unique process ID (UUID) used for future references like `write()` or `stop()`.
   *
   * @example
   * Executor.start('sh', (type, data) => {
   *   console.log(`[${type}] ${data}`);
   * }).then(uuid => {
   *   Executor.write(uuid, 'echo Hello World');
   *   Executor.stop(uuid);
   * });
   */


  start(command, onData) {
    this.start(command, onData, false);
  },

  start(command, onData, alpine) {
    console.log("start: " + command);

    return new Promise((resolve, reject) => {
      let first = true;
      exec(async (message) => {
        console.log(message);
        if (first) {
          first = false;
          await new Promise(resolve => setTimeout(resolve, 100));
          // First message is always the process UUID
          resolve(message);
        } else {
          const match = message.match(/^([^:]+):(.*)$/);
          if (match) {
            const prefix = match[1];     // e.g. "stdout"
            const message = match[2].trim(); // output
            onData(prefix, message);
          } else {
            onData("unknown", message);
          }
        }
      },
        reject,
        "Executor",
        "start",
        [command, String(alpine)]
      );
    });
  },

  /**
   * Sends input to a running process's stdin.
   *
   * @param {string} uuid - The process ID returned by {@link Executor.start}.
   * @param {string} input - Input string to send (e.g., shell commands).
   * @returns {Promise<string>} Resolves once the input is written.
   *
   * @example
   * Executor.write(uuid, 'ls /sdcard');
   */
  write(uuid, input) {
    console.log("write: " + input + " to " + uuid);
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "write", [uuid, input]);
    });
  },

  /**
   * Terminates a running process.
   *
   * @param {string} uuid - The process ID returned by {@link Executor.start}.
   * @returns {Promise<string>} Resolves when the process has been stopped.
   *
   * @example
   * Executor.stop(uuid);
   */
  stop(uuid) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "stop", [uuid]);
    });
  },

  /**
   * Checks if a process is still running.
   *
   * @param {string} uuid - The process ID returned by {@link Executor.start}.
   * @returns {Promise<boolean>} Resolves `true` if the process is running, `false` otherwise.
   *
   * @example
   * const isAlive = await Executor.isRunning(uuid);
   */
  isRunning(uuid) {
    return new Promise((resolve, reject) => {
      exec((result) => {
        resolve(result === "running");
      }, reject, "Executor", "isRunning", [uuid]);
    });
  },

  stopService() {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "stopService", []);
    });
  },

  /**
   * Executes a shell command once and waits for it to finish.
   * Unlike {@link Executor.start}, this does not stream output.
   *
   * @param {string} command - The shell command to execute.
   * @param {boolean} alpine - Whether to run the command in the Alpine sandbox (`true`) or Android environment (`false`).
   * @returns {Promise<string>} Resolves with standard output on success, rejects with an error or standard error on failure.
   *
   * @example
   * Executor.execute('ls -l')
   *   .then(console.log)
   *   .catch(console.error);
   */
  execute(command) {
    this.execute(command, false);
  }
  ,
  execute(command, alpine) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "exec", [command, String(alpine)]);
    });
  },

  loadLibrary(path) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "loadLibrary", [path]);
    });
  }
};

module.exports = Executor;
