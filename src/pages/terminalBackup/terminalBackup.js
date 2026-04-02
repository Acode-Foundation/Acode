import settingsPage from "components/settingsPage";
import toast from "components/toast";
import alert from "dialogs/alert";
import loader from "dialogs/loader";
import FileBrowser from "pages/fileBrowser";
import helpers from "utils/helpers";

export default function TerminalBackup(onclose) {
	const backupSettings = {
		alpineBase: true,
		packages: true,
		home: false,
		public: false,
	};

	const items = [
		{
			key: "alpineBase",
			text: "Alpine",
			checkbox: backupSettings.alpineBase,
			info: strings["alpineBase info"] || "Include Alpine environment",
		},
		/*{
			key: "packages",
			text: strings["packages"] || "Packages",
			checkbox: backupSettings.packages,
			info: strings["packages info"] || "Include installed packages",
		},*/
		{
			key: "home",
			text: strings["home"] || "Home",
			checkbox: backupSettings.home,
			info:
				strings["home info"] ||
				"Include Alpine /home /root and /public directory",
		},
		{
			key: "backup",
			text: strings["backup"],
			chevron: false,
			info: "Create backup with selected components",
		},
	];

	const page = settingsPage(strings["backup"], items, callback, undefined, {
		preserveOrder: true,
		pageClassName: "detail-settings-page",
		listClassName: "detail-settings-list",
		infoAsDescription: true,
		valueInTail: true,
	});

	const oldHide = page.hide;
	page.hide = () => {
		oldHide();
		onclose?.();
	};
	page.show();

	function setPackagesTooltip() {
		const packagesRow = document.querySelector('[data-key="packages"]');
		if (!packagesRow) return;
		const input = packagesRow.querySelector(".input-checkbox input");
		if (input) {
			input.disabled = !!backupSettings.alpineBase;
		}
	}

	function enforcePackageRule(value) {
		if (backupSettings.alpineBase && value === false) {
			toast(
				strings["packages cannot be disabled when alpine base enabled"] ||
					"Packages cannot be disabled while Alpine base is enabled.",
			);
			backupSettings.packages = true;
			const pkgRow = document.querySelector('[data-key="packages"]');
			if (pkgRow) {
				const checkbox = pkgRow.querySelector(".input-checkbox input");
				if (checkbox) checkbox.checked = true;
			}
			return true;
		}
		return false;
	}

	async function performBackup() {
		try {
			const { url } = await FileBrowser("folder", strings["select folder"]);

			if (!url) return;

			loader.showTitleLoader(
				strings["creating backup"] || "Creating backup...",
			);

			const backupPath = await Terminal.backup({
				alpineBase: backupSettings.alpineBase,
				packages: backupSettings.packages,
				home: backupSettings.home,
			});

			await system.copyToUri(
				backupPath,
				url,
				"aterm_backup.tar",
				console.log,
				console.error,
			);

			loader.removeTitleLoader();
			alert(
				strings.success.toUpperCase(),
				`${strings["backup successful"] || "Backup successful"}.`,
			);
		} catch (error) {
			loader.removeTitleLoader();
			console.error("Terminal backup failed:", error);
			toast(error.toString());
		}
	}

	function callback(key, value) {
		switch (key) {
			case "alpineBase":
				backupSettings.alpineBase = value;
				if (value) {
					backupSettings.packages = true;
					const pkgRow = document.querySelector('[data-key="packages"]');
					if (pkgRow) {
						const checkbox = pkgRow.querySelector(".input-checkbox input");
						if (checkbox) checkbox.checked = true;
					}
				}
				setPackagesTooltip();
				break;
			case "packages":
				if (enforcePackageRule(value)) return;
				backupSettings.packages = value;
				break;
			case "home":
				backupSettings.home = value;
				break;
			case "backup":
				performBackup();
				return;
			default:
				break;
		}
	}
}
