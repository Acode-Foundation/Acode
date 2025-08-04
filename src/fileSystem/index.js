import ajax from "@deadlyjack/ajax";
import { decode } from "utils/encodings";
import Url from "utils/Url";
import externalFs from "./externalFs";
import Ftp from "./ftp";
import internalFs from "./internalFs";
import Sftp from "./sftp";

const fsList = [];

/**
 * @typedef {Object} Stat
 * @property {string} name
 * @property {string} url
 * @property {string} uri - deprecated
 * @property {boolean} isFile
 * @property {boolean} isDirectory
 * @property {boolean} isLink
 * @property {number} size
 * @property {number} modifiedDate
 * @property {boolean} canRead
 * @property {boolean} canWrite
 */

/**
 * @typedef {Object} File
 * @property {string} name
 * @property {string} url
 * @property {boolean} isFile
 * @property {boolean} isDirectory
 * @property {boolean} isLink
 */

/**
 * @typedef {string|Blob|ArrayBuffer} FileContent
 * @typedef {Object} FileSystem
 * @property {() => Promise<File[]>} lsDir List directory
 * @property {() => Promise<void>} delete Delete file or directory
 * @property {() => Promise<boolean>} exists Check if file or directory exists
 * @property {() => Promise<Stat>} stat Get file or directory stat
 * @property {(encoding:string) => Promise<FileContent>} readFile Read file
 * @property {(data:FileContent, encoding: string) => Promise<void>} writeFile Write file content
 * @property {(name:string, data:FileContent) => Promise<string>} createFile Create file and return url of the created file
 * @property {(name:string) => Promise<string>} createDirectory Create directory and return url of the created directory
 * @property {(dest:string) => Promise<string>} copyTo Copy file or directory to destination
 * @property {(dest:string) => Promise<string>} moveTo Move file or directory to destination
 * @property {(newname:string) => Promise<string>} renameTo Rename file or directory
 */

/**
 * Create a file system object from a url
 * @param {...string} url
 * @returns {FileSystem}
 */
export default function fsOperation(...url) {
	if (url.length > 1) {
		url = Url.join(...url);
	} else {
		url = url[0];
	}
	return fsList.find((fs) => fs.test(url))?.fs(url);
}

fsOperation.extend = (test, fs) => {
	fsList.push({ test, fs });
};

fsOperation.remove = (test) => {
	const index = fsList.findIndex((fs) => fs.test === test);
	if (index !== -1) {
		fsList.splice(index, 1);
	}
};

fsOperation.extend(Sftp.test, Sftp.fromUrl);
fsOperation.extend(Ftp.test, Ftp.fromUrl);
fsOperation.extend(internalFs.test, (url) => internalFs.createFs(url));
fsOperation.extend(externalFs.test, (url) => externalFs.createFs(url));

fsOperation.extend(
	(url) => /^https?:/.test(url),
	(url) => {
		return {
			async readFile(encoding, progress) {
				const data = await ajax.get(url, {
					responseType: "arraybuffer",
					contentType: "application/x-www-form-urlencoded",
					onprogress: progress,
				});

				if (encoding) {
					return await decode(data, encoding);
				}

				return data;
			},
			async writeFile(content, progress) {
				return ajax.post(url, {
					data: content,
					contentType: "application/x-www-form-urlencoded",
					onprogress: progress,
				});
			},
		};
	},
);
