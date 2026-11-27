import multiPrompt from "dialogs/multiPrompt";
import helpers from "utils/helpers";

export default {
	/**
	 *
	 * @param {Array} list
	 * @param {String} name
	 * @param {String} url
	 * @param {Object} extra
	 */
	pushFolder(list, name, url, extra = {}) {
		list.push({
			url: url,
			name: name,
			isDirectory: true,
			parent: true,
			type: "dir",
			...extra,
		});
	},
	/**
	 * Save a new path using storage access framework
	 * @param {String} name
	 * @returns {Promise<{name: String, uri: String, uuid: string}>}
	 */
	async addPath(name, uuid) {
		const res = await multiPrompt(
			strings["add path"],
			[
				{
					id: "uri",
					placeholder: strings["select folder"],
					type: "text",
					required: true,
					readOnly: true,
					onclick() {
						sdcard.getStorageAccessPermission(
							uuid,
							(res) => {
								const $name = tag.get("#name");
								if (!$name.value && res) {
									const name = window
										.decodeURIComponent(res)
										?.split(":")
										.pop()
										?.split("/")
										.pop();
									$name.value = name ?? "";
								}
								this.value = res;
							},
							(err) => {
								if (helpers.isCancelled(err)) return;
								helpers.error(err);
							},
						);
					},
				},
				{
					id: "name",
					placeholder: strings["folder name"],
					type: "text",
					required: true,
					value: name ?? "",
				},
			],
			"https://acode.app/faqs/224761680",
		);

		if (!res) return;

		return {
			name: res.name,
			uri: res.uri,
			uuid: helpers.uuid(),
		};
	},
};
