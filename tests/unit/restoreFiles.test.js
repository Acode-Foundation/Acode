import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
	instances: [],
}));

vi.mock("lib/editorFile", () => ({
	default: class MockEditorFile {
		constructor(filename, options) {
			this.filename = filename;
			this.options = options;
			this.loaded = new Promise((resolve) => {
				this.resolveLoad = resolve;
			});
			runtime.instances.push(this);
		}

		load() {
			return this.loaded;
		}
	},
}));

import restoreFiles from "lib/restoreFiles";

describe("restored file loading", () => {
	beforeEach(() => {
		runtime.instances.length = 0;
	});

	it("waits for every local tab and activates the last tab by default", async () => {
		let completed = false;
		const restoration = restoreFiles([
			{ id: "one", filename: "one.js", uri: "file:///one.js" },
			{ id: "two", filename: "two.js", uri: "file:///two.js" },
		]).then(() => {
			completed = true;
		});

		expect(runtime.instances).toHaveLength(2);
		expect(runtime.instances.map((file) => file.options.render)).toEqual([
			false,
			true,
		]);
		expect(completed).toBe(false);

		runtime.instances[0].resolveLoad();
		await Promise.resolve();
		expect(completed).toBe(false);

		runtime.instances[1].resolveLoad();
		await restoration;
		expect(completed).toBe(true);
	});

	it.each(["ftp", "sftp", "http", "https"])(
		"does not block startup on an unresolved %s tab",
		async (protocol) => {
			await restoreFiles([
				{
					id: "remote",
					filename: "remote.js",
					uri: `${protocol}://example.com/remote.js`,
				},
			]);

			expect(runtime.instances).toHaveLength(1);
		},
	);
});
