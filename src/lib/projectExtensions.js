import fsOperation from "fileSystem";
import notificationManager from "lib/notificationManager";
import appSettings from "lib/settings";
import workspace from "lib/workspace";
import { isPluginId, sameRecommendations } from "./workspaceExtensions";

/** What was already announced this session, so the same advice is not repeated. */
const announced = new Set();

/**
 * Fill `{name}` placeholders in a translated string.
 * @param {string} text
 * @param {Record<string, string>} values
 * @returns {string}
 */
function format(text, values) {
	return String(text || "").replace(
		/\{(\w+)\}/g,
		(_, key) => values[key] ?? "",
	);
}

/**
 * Pick out the plugins that are not installed yet. A plugin that is installed
 * but switched off counts as installed: that was the user's choice.
 * When Acode cannot tell, the plugin is left out rather than nagged about.
 * @param {readonly string[]} ids
 * @returns {Promise<string[]>}
 */
export async function findMissing(ids) {
	const missing = [];
	for (const id of ids) {
		// The ids were checked when the file was read. Check again, because an id
		// becomes part of a file path right here.
		if (!isPluginId(id)) continue;
		try {
			if (!(await fsOperation(PLUGIN_DIR, id).exists())) missing.push(id);
		} catch (error) {
			// Unknown, so say nothing.
		}
	}
	return missing;
}

/**
 * Open the registry page of a recommended plugin. The page shows its details
 * and an install button; nothing is installed unless the user presses it.
 * @param {readonly string[]} ids The recommended plugins that are missing.
 */
export async function review(ids) {
	let id = ids[0];
	if (ids.length > 1) {
		const { default: select } = await import("dialogs/select");
		id = await select(strings.plugins, [...ids]);
	}
	if (!isPluginId(id)) return;

	const { openWithSearch } = await import("sidebarApps/extensions");
	openWithSearch(`id:${id}`);
}

/**
 * Tell the user, once, about plugins a workspace recommends that they lack.
 * @param {import("./workspace").Workspace} ws
 * @returns {Promise<boolean>} Whether a notification was shown.
 */
export async function recommend(ws) {
	if (appSettings.value.recommendExtensions === false) return false;

	const ids = ws.extensions?.recommendations ?? [];
	if (!ids.length) return false;

	const missing = await findMissing(ids);
	if (!missing.length) return false;

	// The project may have been closed or its list edited while we were looking.
	const current = workspace.get(ws.url);
	if (!current || !sameRecommendations(current.extensions, ws.extensions)) {
		return false;
	}

	const key = `${ws.url}\n${missing.join("\n")}`;
	if (announced.has(key)) return false;
	announced.add(key);

	const project = ws.name || ws.url;
	const open = () => {
		review(missing).catch((error) => {
			console.warn("Failed to open recommended plugin.", error);
		});
	};

	notificationManager.pushNotification({
		title: format(strings["project extensions title"], { project }),
		message: format(strings["project extensions message"], {
			project,
			plugins: missing.join(", "),
		}),
		icon: "extension",
		type: "info",
		action: open,
		actions: [
			{
				text: strings["review recommendations"],
				icon: "extension",
				action: open,
			},
		],
	});
	return true;
}

/**
 * Start watching workspaces for plugin recommendations.
 * Needs `workspace.init` to have been called.
 * @returns {() => void} Stops watching and forgets what was announced.
 */
export function init() {
	const onWorkspace = (ws) => {
		recommend(ws).catch((error) => {
			console.warn("Failed to check plugin recommendations.", error);
		});
	};

	workspace.on("open", onWorkspace);
	workspace.on("extensions", onWorkspace);

	return () => {
		workspace.off("open", onWorkspace);
		workspace.off("extensions", onWorkspace);
		announced.clear();
	};
}

export default { init, recommend, review, findMissing };
