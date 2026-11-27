import platform from "lib/platform";
import { toArrayBuffer } from "native/base64";
import Executor from "native/terminal/Executor";
import copyEntry from "utils/copyEntry";
import { decode, encode } from "utils/encodings";
import { quotePosixShellArg as quote } from "utils/shell";
import Url from "utils/Url";
import internalFs from "./internalFs";

export default { test, createFs };

function test(url) {
	return platform.isIOS && /^alpine:\/\/localhost\//.test(url);
}

function guestPath(url) {
	if (!test(url)) throw new Error("Invalid Alpine URL");
	return decodeURIComponent(new URL(url).pathname);
}

function guestUrl(path) {
	return `alpine://localhost${path.split("/").map(encodeURIComponent).join("/")}`;
}

function run(command) {
	return Executor.BackgroundExecutor.execute(command, true);
}

function createFs(url) {
	const path = guestPath(url);
	const source = quote(path);
	return {
		async lsDir() {
			const encoded = await run(
				`set -o pipefail; find ${source} -mindepth 1 -maxdepth 1 -print0 | base64`,
			);
			const paths = new TextDecoder().decode(toArrayBuffer(encoded));
			return Promise.all(
				paths
					.split("\0")
					.filter(Boolean)
					.map((path) => createFs(guestUrl(path)).stat()),
			);
		},
		async stat() {
			const fields = (await run(`stat -L -c '%f:%s:%Y' -- ${source}`)).split(
				":",
			);
			const mode = Number.parseInt(fields[0], 16);
			const isDirectory = (mode & 0xf000) === 0x4000;
			return {
				name: path.split("/").pop(),
				url,
				uri: url,
				isDirectory,
				isFile: !isDirectory,
				isLink: false,
				size: Number(fields[1]),
				modifiedDate: Number(fields[2]) * 1000,
				canRead: true,
				canWrite: true,
			};
		},
		async exists() {
			return (await run(`[ -e ${source} ] && echo yes || echo no`)) === "yes";
		},
		async readFile(encoding) {
			const data = toArrayBuffer(await run(`base64 < ${source}`));
			return encoding ? decode(data, encoding) : data;
		},
		async writeFile(content, encoding) {
			if (typeof content === "string" && encoding)
				content = await encode(content, encoding);
			await write(path, content, false);
			return url;
		},
		async createFile(name, content = "") {
			const target = Url.join(url, name);
			await write(guestPath(target), content, true);
			return target;
		},
		async createDirectory(name) {
			const target = Url.join(url, name);
			await run(`mkdir -- ${quote(guestPath(target))}`);
			return target;
		},
		async delete() {
			if (path === "/") throw new Error("Cannot remove the Alpine root");
			await run(`rm -rf -- ${source}`);
		},
		async renameTo(name) {
			if (name.includes("/")) throw new Error("Invalid file name");
			const target = Url.join(Url.dirname(url), name);
			await run(`mv -- ${source} ${quote(guestPath(target))}`);
			return target;
		},
		async copyTo(destination) {
			if (test(destination)) {
				await run(`cp -a -- ${source} ${quote(guestPath(destination))}/`);
				return Url.join(destination, Url.basename(url));
			}
			return (await copyEntry(url, destination)).url;
		},
		async moveTo(destination) {
			const target = await this.copyTo(destination);
			await this.delete();
			return target;
		},
	};
}

async function write(path, content, exclusive) {
	const name = `terminal-write-${crypto.randomUUID()}`;
	const temporary = Bridge.file.dataDirectory + name;
	try {
		await internalFs.writeFile(temporary, content, true, true);
		const guard = exclusive ? "set -C;" : `[ -f ${quote(path)} ] || exit 1;`;
		await run(`${guard} cat ${quote(`/acode/${name}`)} > ${quote(path)}`);
	} finally {
		await internalFs.delete(temporary).catch(() => {});
	}
}
