import alert from "dialogs/alert";
import confirm from "dialogs/confirm";
import loader from "dialogs/loader";
import select from "dialogs/select";
import notificationManager from "./notificationManager";
import openFolder from "./openFolder";
import terminalStorage from "./terminalStorage";

const RECOVERY_TITLE = "Terminal project recovery";

function openLegacyRoot(status, kind) {
	const root = status.roots[kind];
	if (!root?.hasData) return false;
	openFolder(root.url, {
		name: `${root.label} (Recovery)`,
		saveState: true,
		listFiles: true,
	});
	return true;
}

function formatImportResult(result) {
	const folders = Object.values(result.destinations).filter(Boolean);
	const paths = folders.map((item) => item.destination).join("<br>");
	if (result.verified) {
		return `Copied and verified ${result.copied} entries.<br><br>${paths}<br><br>The original legacy folders were not changed.`;
	}
	const errors = result.errors.map((error) => error.message).join("<br>");
	return `Recovery was incomplete. The original files are still untouched.<br><br>${paths}<br><br>${errors}`;
}

export async function showLegacyStorageRecovery(preferredAction = null) {
	let status;
	try {
		status = await terminalStorage.getStatus();
	} catch (error) {
		alert(RECOVERY_TITLE, `Unable to inspect legacy storage: ${error}`);
		return null;
	}

	if (!status.hasLegacyData) {
		alert(RECOVERY_TITLE, "No legacy Home or Root files were found.");
		return null;
	}

	let action = preferredAction;
	if (!action) {
		const options = [];
		if (status.roots.home.hasData) {
			options.push({
				value: "open-home",
				text: "Open legacy Home",
				subText: "Work with the original files at /legacy-home",
				icon: "folder_open",
			});
		}
		if (status.roots.root.hasData) {
			options.push({
				value: "open-root",
				text: "Open legacy Root",
				subText: "Work with the original files at /legacy-root",
				icon: "folder_open",
			});
		}
		options.push({
			value: "import",
			text: "Import recovery copies",
			subText: "Copy and verify files in timestamped Public folders",
			icon: "content_copy",
		});
		action = await select(RECOVERY_TITLE, options);
	}

	if (action === "open-home") {
		return openLegacyRoot(status, "home");
	}
	if (action === "open-root") {
		return openLegacyRoot(status, "root");
	}
	if (action !== "import") return null;

	const approved = await confirm(
		RECOVERY_TITLE,
		"Acode will stop active terminal processes and copy the legacy folders into timestamped folders under Public. Originals will not be deleted or overwritten. Continue?",
	);
	if (!approved) return null;

	loader.showTitleLoader();
	try {
		const result = await terminalStorage.importCopies(status);
		alert(
			result.verified ? strings.success.toUpperCase() : strings.warning,
			formatImportResult(result),
		);
		return result;
	} catch (error) {
		alert(
			RECOVERY_TITLE,
			`Import failed. Your original legacy files were not removed.<br><br>${error}`,
		);
		return null;
	} finally {
		loader.removeTitleLoader();
	}
}

export async function notifyLegacyStorageRecovery() {
	try {
		const status = await terminalStorage.getStatus();
		if (!status.hasLegacyData) return false;

		notificationManager.pushNotification({
			title: RECOVERY_TITLE,
			message:
				"Files remain in the previous terminal Home/Root. Do not uninstall Terminal, clear Acode storage, or reinstall before recovering them.",
			icon: "warning",
			type: "warning",
			action: () => showLegacyStorageRecovery(),
			actions: [
				...(status.roots.home.hasData
					? [
							{
								text: "Open legacy Home",
								action: () => showLegacyStorageRecovery("open-home"),
							},
						]
					: []),
				{
					text: "Import copies",
					action: () => showLegacyStorageRecovery("import"),
				},
			],
		});
		return true;
	} catch (error) {
		console.error("Unable to inspect legacy terminal storage:", error);
		return false;
	}
}
