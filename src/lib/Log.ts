/**
 * Android.util.Log
 */
export class Log {
	constructor(private tag: string) {}

	private format(level: string, message: any): string {
		const time = new Date().toISOString();
		return `[${time}] [${this.tag}] [${level}] ${message}`;
	}

	i(message: any, ...args: any[]): void {
		console.log(`%c${this.format("INFO", message)}`, "color: #00aaff", ...args);
	}

	w(message: any, ...args: any[]): void {
		console.warn(
			`%c${this.format("WARN", message)}`,
			"color: #ffaa00",
			...args,
		);
	}

	e(message: any, ...args: any[]): void {
		console.error(
			`%c${this.format("ERROR", message)}`,
			"color: #ff4444",
			...args,
		);
	}

	d(message: any, ...args: any[]): void {
		//TODO: Only show debug messages in debug mode
		console.log(
			`%c${this.format("DEBUG", message)}`,
			"color: #999999",
			...args,
		);
	}
}
