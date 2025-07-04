/**
 * Executor module for interacting with shell processes on Cordova.
 * Allows starting processes with real-time streaming, writing input,
 * stopping processes, and traditional one-time execution.
 *
 * @module Executor
 */

const exec = require('cordova/exec');

const Executor = {
  /**
   * Starts a shell process and sets up real-time streaming for stdout, stderr, and exit events.
   *
   * @param {string} command - The shell command to execute (e.g., `"sh"`, `"ls -al"`).
   * @param {(type: 'stdout' | 'stderr' | 'exit', data: string) => void} onData - Callback to handle real-time output:
   *   - `"stdout"`: Standard output line.
   *   - `"stderr"`: Standard error line.
   *   - `"exit"`: Process exit code.
   *
   * @returns {Promise<string>} Resolves with the process ID (PID).
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
    return new Promise((resolve, reject) => {
      exec(
        (message) => {
          if (message.startsWith("stdout:")) return onData("stdout", message.slice(7));
          if (message.startsWith("stderr:")) return onData("stderr", message.slice(7));
          if (message.startsWith("exit:")) return onData("exit", message.slice(5));
          // First message is PID
          resolve(message);
        },
        reject,
        "Executor",
        "start",
        [command]
      );
    });
  },

  /**
   * Sends input to the stdin of a running process.
   *
   * @param {string} uuid - The process ID returned by {@link Executor.start}.
   * @param {string} input - The input string to send to the process.
   * @returns {Promise<string>} Resolves when the input is successfully written.
   *
   * @example
   * Executor.write(uuid, 'ls /data');
   */
  write(uuid, input) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "write", [uuid, input]);
    });
  },

  /**
   * Stops a running process.
   *
   * @param {string} uuid - The process ID returned by {@link Executor.start}.
   * @returns {Promise<string>} Resolves when the process is terminated.
   *
   * @example
   * Executor.stop(uuid);
   */
  stop(uuid) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "stop", [uuid]);
    });
  },
  isRunning(uuid) {
    return new Promise((resolve, reject) => {
      exec((result)=>{
        if(result === "running"){
          resolve(true)
        }else if(result === "exited"){
          resolve(false)
        }else{
          resolve(false)
        }
      }, reject, "Executor", "isRunning", [uuid]);
    });
  },

  /**
   * Executes a shell command and waits for it to finish.
   * Unlike `start()`, this is a one-time execution and does not stream real-time output.
   *
   * @param {string} command - The command to execute.
   * @returns {Promise<string>} Resolves with stdout if the command succeeds, rejects with stderr or error message if it fails.
   *
   * @example
   * Executor.execute('ls -l').then(output => {
   *   console.log(output);
   * }).catch(error => {
   *   console.error(error);
   * });
   */
  execute(command) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, "Executor", "exec", [command]);
    });
  }
};

module.exports = Executor;
