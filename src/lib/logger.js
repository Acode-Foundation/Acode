import fsOperation from "fileSystem";
import Url from "utils/Url";
import constants from "./constants";

/*
/**
 * Logger class for handling application logging with buffer and file output.
 * @class
 */

/**
 * Creates a new Logger instance.
 * @constructor
 * @param {number} [maxBufferSize=1000] - Maximum number of log entries to keep in buffer.
 * @param {string} [logLevel="info"] - Minimum log level to record ("error", "warn", "info", "debug").
 * @param {number} [flushInterval=30000] - Interval in milliseconds for automatic log flushing.
 */
class Logger {
	#logBuffer;
	#maxBufferSize;
	#logLevel;
	#logFileName;
	#flushInterval;
	#autoFlushInterval;
	#maxFileSize;

	constructor(
		maxBufferSize = 1000,
		logLevel = "info",
		flushInterval = 30000,
		maxFileSize = 10 * 1024 * 1024,
	) {
		this.#logBuffer = new Map();
		this.#maxBufferSize = maxBufferSize;
		this.#logLevel = logLevel;
		this.#logFileName = constants.LOG_FILE_NAME;
		this.#flushInterval = flushInterval;
		this.#maxFileSize = maxFileSize;
		this.#startAutoFlush(); // Automatically flush logs at intervals
		this.#setupAppLifecycleHandlers(); // Handle app lifecycle events for safe log saving
	}

	/**
	 * Logs a message with the specified log level.
	 * @param {'error' | 'warn' | 'info' | 'debug'} level - The log level.
	 * @param {string} message - The message to be logged.
	 */
	log(level, message) {
		const levels = ["error", "warn", "info", "debug"];
		if (levels.indexOf(level) <= levels.indexOf(this.#logLevel)) {
			let logEntry;

			// Check if the message is an instance of Error
			if (message instanceof Error) {
				logEntry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message.name}: ${message.message}\nStack trace: ${message.stack}`;
			} else {
				logEntry = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
			}
			// LRU Mechanism for efficient log buffer management
			if (this.#logBuffer.size >= this.#maxBufferSize) {
				// Remove oldest entry
				const oldestKey = this.#logBuffer.keys().next().value;
				this.#logBuffer.delete(oldestKey);
			}
			this.#logBuffer.set(Date.now(), logEntry); // Using timestamp as key
		}
	}

	flushLogs() {
		if (this.#logBuffer.size > 0) {
			const logContent = Array.from(this.#logBuffer.values()).join("\n");
			this.#writeLogToFile(logContent);
			this.#logBuffer.clear(); // Clear the buffer after flushing
		}
	}

	#writeLogToFile = async (logContent) => {
		try {
			const logFilePath = Url.join(DATA_STORAGE, constants.LOG_FILE_NAME);
			if (!(await fsOperation(logFilePath).exists())) {
				await fsOperation(window.DATA_STORAGE).createFile(
					constants.LOG_FILE_NAME,
					logContent,
				);
			} else {
				let existingData = await fsOperation(logFilePath).readFile("utf8");
				let newData = existingData + "\n" + logContent;
				// Check if the new data exceeds the maximum file size
				if (new Blob([newData]).size > this.#maxFileSize) {
					const lines = newData.split("\n");
					while (
						new Blob([lines.join("\n")]).size > this.#maxFileSize &&
						lines.length > 0
					) {
						lines.shift();
					}
					newData = lines.join("\n");
				}

				await fsOperation(logFilePath).writeFile(newData);
			}
		} catch (error) {
			console.error(
				"Error in handling fs operation on log file. Error:",
				error,
			);
		}
	};

	#startAutoFlush = () => {
		this.#autoFlushInterval = setInterval(() => {
			this.flushLogs();
		}, this.#flushInterval);
	};

	stopAutoFlush() {
		clearInterval(this.#autoFlushInterval);
	}

	#setupAppLifecycleHandlers = () => {
		document.addEventListener(
			"pause",
			() => {
				this.flushLogs(); // Flush logs when app is paused (background)
			},
			false,
		);
	};
}

export default Logger;
