import { Exception } from "sass";
import { FileObject } from "./fileObject";

declare var cordova: any;

//alternative for internalFs.js
export class NativeFileWrapper implements FileObject {
	private path: string | undefined;

	//always check if fileobject is ready before calling any class function
	ready: Promise<void>;

	private removePrefix(str: string, prefix: string): string {
		return str.startsWith(prefix) ? str.slice(prefix.length) : str;
	}

	constructor(
		absolutePathOrUri: string,
		onReady: (obj: NativeFileWrapper) => void,
	) {
		this.ready = (async () => {
			let temp = absolutePathOrUri;

			//NOTE: only cvfiles are supported which are backed by the native filesystem files with http:// is not supported
			if (absolutePathOrUri.startsWith("cdvfile://")) {
				temp = await new Promise<string>((resolve, reject) => {
					// @ts-ignore
					window.resolveLocalFileSystemURL(
						absolutePathOrUri,
						//                             nativeURL
						(entry: any) => resolve(entry.nativeURL()),
						reject,
					);
				});
			}

			this.path = this.removePrefix(temp, "file://");

			if (!this.path.endsWith("/")) {
				throw new Error(
					`Path "${absolutePathOrUri}" converted to "${this.path}" which is invalid since it does not start with / `,
				);
			}

			onReady(this);
		})();
	}

	private execPlugin(action: string, args: any[] = []): Promise<any> {
		//console.log(`[NativeFileWrapper] execPlugin called: action=${action}, args=${JSON.stringify(args)}`);
		return new Promise((resolve, reject) => {
			cordova.exec(
				(result: any) => {
					//console.log(`[NativeFileWrapper] execPlugin success: action=${action}, result=${JSON.stringify(result)}`);
					resolve(result);
				},
				(error: any) => {
					console.error(
						`[NativeFileWrapper] execPlugin error: action=${action}, error=${JSON.stringify(error)}`,
					);
					reject(error);
				},
				"nativeFile",
				action,
				[this.path, ...args],
			);
		});
	}

	async canRead(): Promise<boolean> {
		const result = await this.execPlugin("canRead");
		//console.log(`[canRead] path=${this.path}, result=${result}`);
		return result === 1;
	}

	async canWrite(): Promise<boolean> {
		const result = await this.execPlugin("canWrite");
		//console.log(`[canWrite] path=${this.path}, result=${result}`);
		return result === 1;
	}

	async childByNameExists(name: string): Promise<boolean | null> {
		try {
			const result = await this.execPlugin("childByNameExists", [name]);
			//console.log(`[childByNameExists] path=${this.path}, name=${name}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(
				`[childByNameExists] path=${this.path}, name=${name}, error=${error}`,
			);
			return null;
		}
	}

	async createNewFile(): Promise<boolean> {
		try {
			const result = await this.execPlugin("createNewFile");
			//console.log(`[createNewFile] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[createNewFile] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async delete(): Promise<boolean> {
		try {
			const result = await this.execPlugin("delete");
			//console.log(`[delete] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[delete] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async exists(): Promise<boolean> {
		try {
			const result = await this.execPlugin("exists");
			//console.log(`[exists] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[exists] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async getChildByName(name: string): Promise<FileObject | null> {
		try {
			const childPath = await this.execPlugin("getChildByName", [name]);
			//console.log(`[getChildByName] path=${this.path}, name=${name}, childPath=${childPath}`);
			if (childPath && childPath !== "") {
				return new NativeFileWrapper(childPath, () => {});
			}
			return null;
		} catch (error) {
			console.error(
				`[getChildByName] path=${this.path}, name=${name}, error=${error}`,
			);
			return null;
		}
	}

	async getLength(): Promise<number> {
		try {
			const result = await this.execPlugin("getLength");
			//console.log(`[getLength] path=${this.path}, length=${result}`);
			return result;
		} catch (error) {
			console.error(`[getLength] path=${this.path}, error=${error}`);
			return 0;
		}
	}

	async getName(): Promise<string> {
		try {
			const name = await this.execPlugin("getName");
			//console.log(`[getName] path=${this.path}, name=${name}`);
			return name;
		} catch (error) {
			console.error(`[getName] path=${this.path}, error=${error}`);
			throw new Error(`Failed to read file name: ${error}`);
		}
	}

	async getParentFile(): Promise<FileObject | null> {
		try {
			const parentPath = await this.execPlugin("getParentFile");
			//console.log(`[getParentFile] path=${this.path}, parentPath=${parentPath}`);
			if (parentPath && parentPath !== "") {
				return new NativeFileWrapper(parentPath, () => {});
			}
			return null;
		} catch (error) {
			console.error(`[getParentFile] path=${this.path}, error=${error}`);
			return null;
		}
	}

	async isDirectory(): Promise<boolean> {
		try {
			const result = await this.execPlugin("isDirectory");
			//console.log(`[isDirectory] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[isDirectory] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async isFile(): Promise<boolean> {
		try {
			const result = await this.execPlugin("isFile");
			//console.log(`[isFile] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[isFile] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async isLink(): Promise<boolean> {
		try {
			const result = await this.execPlugin("isLink");
			//console.log(`[isLink] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[isLink] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async isNative(): Promise<boolean> {
		try {
			const result = await this.execPlugin("isNative");
			//console.log(`[isNative] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[isNative] path=${this.path}, error=${error}`);
			return true;
		}
	}

	async isUnixLike(): Promise<boolean> {
		try {
			const result = await this.execPlugin("isUnixLike");
			//console.log(`[isUnixLike] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[isUnixLike] path=${this.path}, error=${error}`);
			return true;
		}
	}

	async listFiles(): Promise<FileObject[]> {
		try {
			const paths: string[] = await this.execPlugin("listFiles");
			//console.log(`[listFiles] path=${this.path}, files=${JSON.stringify(paths)}`);
			return paths.map((path) => new NativeFileWrapper(path, () => {}));
		} catch (error) {
			console.error(`[listFiles] path=${this.path}, error=${error}`);
			return [];
		}
	}

	async mkdir(): Promise<boolean> {
		try {
			const result = await this.execPlugin("mkdir");
			//console.log(`[mkdir] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[mkdir] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async mkdirs(): Promise<boolean> {
		try {
			const result = await this.execPlugin("mkdirs");
			//console.log(`[mkdirs] path=${this.path}, result=${result}`);
			return result === 1;
		} catch (error) {
			console.error(`[mkdirs] path=${this.path}, error=${error}`);
			return false;
		}
	}

	async readText(encoding: string = "UTF-8"): Promise<string> {
		try {
			const content = await this.execPlugin("readText", [encoding]);
			//console.log(`[readText] path=${this.path}, content length=${content?.length}`);
			return content;
		} catch (error) {
			console.error(`[readText] path=${this.path}, error=${error}`);
			throw new Error(`Failed to read file: ${error}`);
		}
	}

	async toUri(): Promise<string> {
		try {
			//console.log(`[toUri] path=${this.path}, uri=${uri}`);
			return await this.execPlugin("toUri");
		} catch (error) {
			console.error(`[toUri] path=${this.path}, error=${error}`);
			return `file://${this.path}`;
		}
	}

	async writeText(text: string, encoding: string = "UTF-8"): Promise<void> {
		try {
			await this.execPlugin("writeText", [text, encoding]);
			//console.log(`[writeText] path=${this.path}, text length=${text.length}`);
		} catch (error) {
			console.error(`[writeText] path=${this.path}, error=${error}`);
			throw new Error(`Failed to write file: ${error}`);
		}
	}

	getPath(): string {
		//console.log(`[getPath] returning path=${this.path}`);
		return this.path!!;
	}
}
