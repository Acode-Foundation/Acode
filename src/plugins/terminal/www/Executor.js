/**
 * @class Executor
 * @description
 * This class provides an interface to run shell commands from a Cordova app.
 * It supports real-time process streaming, writing input to running processes,
 * stopping them, and executing one-time commands.
 */

const exec = require('cordova/exec');

class Executor {
  constructor(BackgroundExecutor = false) {
    this.ExecutorType = BackgroundExecutor ? "BackgroundExecutor" : "Executor";
  }
  /**
   * Starts a shell process and enables real-time streaming of stdout, stderr, and exit status.
   *
   * @param {string} command - The shell command to run (e.g., `"sh"`, `"ls -al"`).
   * @param {(type: 'stdout' | 'stderr' | 'exit', data: string) => void} onData - Callback that receives real-time output:
   *   - `"stdout"`: Standard output line.
   *   - `"stderr"`: Standard error line.
   *   - `"exit"`: Exit code of the process.
   * @param {boolean} [alpine=false] - Whether to run the command inside the Alpine sandbox environment (`true`) or on Android directly (`false`).
   * @returns {Promise<string>} Resolves with a unique process ID (UUID) used for future references like `write()` or `stop()`.
   *
   * @example
   * const executor = new Executor();
   * executor.start('sh', (type, data) => {
   *   //console.log(`[${type}] ${data}`);
   * }).then(uuid => {
   *   executor.write(uuid, 'echo Hello World');
   *   executor.stop(uuid);
   * });
   */
  start(command, onData, alpine = false) {
    return new Promise((resolve, reject) => {
      let first = true;
      exec(
        async (message) => {
          //console.log(message);
          if (first) {
            first = false;
            await new Promise(resolve => setTimeout(resolve, 100));
            // First message is always the process UUID
            resolve(message);
          } else {
            const match = message.match(/^([^:]+):(.*)$/);
            if (match) {
              const prefix = match[1];         // e.g. "stdout"
              const content = match[2]; // output
              onData(prefix, content);
            } else {
              onData("unknown", message);
            }
          }
        },
        reject,
        this.ExecutorType,
        "start",
        [command, String(alpine)]
      );
    });
  }

  /**
   * Sends input to a running process's stdin.
   *
   * @param {string} uuid - The process ID returned by {@link Executor#start}.
   * @param {string} input - Input string to send (e.g., shell commands).
   * @returns {Promise<string>} Resolves once the input is written.
   *
   * @example
   * executor.write(uuid, 'ls /sdcard');
   */
  write(uuid, input) {
    //console.log("write: " + input + " to " + uuid);
    return new Promise((resolve, reject) => {
      exec(resolve, reject, this.ExecutorType, "write", [uuid, input]);
    });
  }

  /**
   * Moves the executor service to the background (stops foreground notification).
   *
   * @returns {Promise<string>} Resolves when the service is moved to background.
   *
   * @example
   * executor.moveToBackground();
   */
  moveToBackground() {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, this.ExecutorType, "moveToBackground", []);
    });
  }

  /**
   * Moves the executor service to the foreground (shows notification).
   *
   * @returns {Promise<string>} Resolves when the service is moved to foreground.
   *
   * @example
   * executor.moveToForeground();
   */
  moveToForeground() {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, this.ExecutorType, "moveToForeground", []);
    });
  }

  /**
   * Terminates a running process.
   *
   * @param {string} uuid - The process ID returned by {@link Executor#start}.
   * @returns {Promise<string>} Resolves when the process has been stopped.
   *
   * @example
   * executor.stop(uuid);
   */
  stop(uuid) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, this.ExecutorType, "stop", [uuid]);
    });
  }

  /**
   * Checks if a process is still running.
   *
   * @param {string} uuid - The process ID returned by {@link Executor#start}.
   * @returns {Promise<boolean>} Resolves `true` if the process is running, `false` otherwise.
   *
   * @example
   * const isAlive = await executor.isRunning(uuid);
   */
  isRunning(uuid) {
    return new Promise((resolve, reject) => {
      exec(
        (result) => {
          resolve(result === "running");
        },
        reject,
        this.ExecutorType,
        "isRunning",
        [uuid]
      );
    });
  }

  /**
   * Stops the executor service completely.
   *
   * @returns {Promise<string>} Resolves when the service has been stopped.
   *
   * @example
   * executor.stopService();
   */
  stopService() {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, this.ExecutorType, "stopService", []);
    });
  }

  /**
   * Executes a shell command once and waits for it to finish.
   * Unlike {@link Executor#start}, this does not stream output.
   *
   * @param {string} command - The shell command to execute.
   * @param {boolean} [alpine=false] - Whether to run the command in the Alpine sandbox (`true`) or Android environment (`false`).
   * @returns {Promise<string>} Resolves with standard output on success, rejects with an error or standard error on failure.
   *
   * @example
   * executor.execute('ls -l')
   *   .then(//console.log)
   *   .catch(console.error);
   */
  execute(command, alpine = false) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, this.ExecutorType, "exec", [command, String(alpine)]);
    });
  }

  /**
   * Loads a native library from the specified path.
   *
   * @param {string} path - The path to the native library to load.
   * @returns {Promise<string>} Resolves when the library has been loaded.
   *
   * @example
   * executor.loadLibrary('/path/to/library.so');
   */
  loadLibrary(path) {
    return new Promise((resolve, reject) => {
      exec(resolve, reject, this.ExecutorType, "loadLibrary", [path]);
    });
  }
}

//backward compatibility
const executorInstance = new Executor();
executorInstance.BackgroundExecutor = new Executor(true);

module.exports = executorInstance;
