export default {
	/**
	 * The path.dirname() method returns the directory name of a path,
	 * similar to the Unix dirname command.
	 * Trailing directory separators are ignored.
	 * @param {string} path
	 * @returns {string}
	 */
	dirname(path) {
		if (path.endsWith("/")) path = path.slice(0, -1);
		const parts = path.split("/").slice(0, -1);
		if (!/^(\.|\.\.|)$/.test(parts[0])) parts.unshift(".");
		const res = parts.join("/");

		if (!res) return "/";
		else return res;
	},

	/**
	 * The path.basename() methods returns the last portion of a path,
	 * similar to the Unix basename command.
	 * Trailing directory separators are ignored, see path.sep.
	 * @param {string} path
	 * @returns {string}
	 */
	basename(path, ext = "") {
		ext = ext || "";
		if (path === "" || path === "/") return path;
		const ar = path.split("/");
		const last = ar.slice(-1)[0];
		if (!last) return ar.slice(-2)[0];
		let res = decodeURI(last.split("?")[0] || "");
		if (this.extname(res) === ext) res = res.replace(new RegExp(ext + "$"), "");
		return res;
	},

	/**
	 * returns the extension of the path, from the last occurrence of the . (period)
	 * character to end of string in the last portion of the path.
	 * If there is no . in the last portion of the path, or if there are no . characters
	 * other than the first character of the basename of path (see path.basename()) , an
	 * empty string is returned.
	 * @param {string} path
	 */
	extname(path) {
		const filename = path.split("/").slice(-1)[0];
		if (/.+\..*$/.test(filename)) {
			return /(?:\.([^.]*))?$/.exec(filename)[0] || "";
		}

		return "";
	},

	/**
	 * returns a path string from an object.
	 * @param {PathObject} pathObject
	 */
	format(pathObject) {
		let { root, dir, ext, name, base } = pathObject;

		if (base || !ext.startsWith(".")) {
			ext = "";
			if (base) name = "";
		}

		dir = dir || root;

		if (!dir.endsWith("/")) dir += "/";

		return dir + (base || name) + ext;
	},

	/**
	 * The path.isAbsolute() method determines if path is an absolute path.
	 * @param {string} path
	 */
	isAbsolute(path) {
		return path.startsWith("/");
	},

	/**
	 * Joins the given number of paths
	 * @param  {...string} paths
	 */
	join(...paths) {
		const res = paths.join("/");
		return this.normalize(res);
	},

	/**
	 * Normalizes the given path, resolving '..' and '.' segments.
	 * @param {string} path
	 */
	normalize(path) {
		path = path.replace(/\.\/+/g, "./");
		path = path.replace(/\/+/g, "/");

		const resolved = [];
		const pathAr = path.split("/");

		pathAr.forEach((dir) => {
			if (dir === "..") {
				if (resolved.length) resolved.pop();
			} else if (dir === ".") {
				return;
			} else {
				resolved.push(dir);
			}
		});

		return resolved.join("/");
	},

	/**
	 *
	 * @param {string} path
	 * @returns {PathObject}
	 */
	parse(path) {
		const root = path.startsWith("/") ? "/" : "";
		const dir = this.dirname(path);
		const ext = this.extname(path);
		const name = this.basename(path, ext);
		const base = this.basename(path);

		return {
			root,
			dir,
			base,
			ext,
			name,
		};
	},

	/**
 * Resolve the path eg.
```js
resolvePath('path/to/some/dir/', '../../dir') //returns 'path/to/dir'
```
 * @param {...string} paths 
 */
	resolve(...paths) {
		if (!paths.length) throw new Error("resolve(...path) : Arguments missing!");

		let result = "";

		paths.forEach((path) => {
			if (path.startsWith("/")) {
				result = path;
				return;
			}

			result = this.normalize(this.join(result, path));
		});

		if (result.startsWith("/")) return result;
		else return "/" + result;
	},

	/**
	 * Gets path for path2 relative to path1
	 * @param {String} path1
	 * @param {String} path2
	 */
	convertToRelative(path1, path2) {
		path1 = this.normalize(path1).split("/");
		path2 = this.normalize(path2).split("/");

		const p1len = path1.length;
		const p2len = path2.length;

		let flag = false;
		const path = [];

		path1.forEach((dir, i) => {
			if (dir === path2[i] && !flag) return;

			path.push(path2[i]);
			if (!flag) {
				flag = true;
				return;
			}

			if (flag) path.unshift("..");
		});

		if (p2len > p1len) path.push(...path2.slice(p1len));

		return path.join("/");
	},
};
