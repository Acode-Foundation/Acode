import "./style.scss";
import fsOperation from "fileSystem";
import Contextmenu from "components/contextmenu";
import Page from "components/page";
import toast from "components/toast";
import Ref from "html-tag-js/ref";
import actionStack from "lib/actionStack";
import markdownIt from "markdown-it";
import markdownItFootnote from "markdown-it-footnote";
import markdownItTaskLists from "markdown-it-task-lists";
import helpers from "utils/helpers";

export default async function Changelog() {
	const GITHUB_API_URL =
		"https://api.github.com/repos/Acode-Foundation/Acode/releases";
	const CHANGELOG_FILE_URL =
		"https://raw.githubusercontent.com/Acode-Foundation/Acode/main/CHANGELOG.md";
	const currentVersion = BuildInfo.version;

	let selectedVersion = currentVersion;
	let selectedStatus = "current";
	const versionIndicatorRef = Ref();
	const versionTextRef = Ref();
	const body = Ref();

	const versionSelector = (
		<div className="changelog-version-selector" data-action="select-version">
			<span
				className={"status-indicator status-" + selectedStatus}
				ref={versionIndicatorRef}
			></span>
			<span ref={versionTextRef}>{selectedVersion}</span>
		</div>
	);

	const $page = Page(strings["changelog"], {
		tail: versionSelector,
	});

	const versionSelectorMenu = Contextmenu({
		top: "36px",
		right: "5px",
		toggler: versionSelector,
		transformOrigin: "top right",
		onclick: menuClickHandler,
		innerHTML: () => {
			return `
        <li action="current">
          <span class="text">Current Version (${currentVersion})</span>
        </li>
        <li action="latest">
          <span class="text">Latest Release</span>
        </li>
        <li action="beta">
          <span class="text">Beta Version</span>
        </li>
        <li action="full">
          <span class="text">Full Changelog</span>
        </li>
      `;
		},
	});

	const changelogMd = await import("../../../CHANGELOG.md");

	toast("Loading changelog...");
	loadVersionChangelog();
	body.onref = () => renderChangelog(changelogMd.default);
	$page.body = <div className="md" id="changelog" ref={body} />;
	app.append($page);
	helpers.showAd();

	$page.onhide = function () {
		actionStack.remove("changelog");
		helpers.hideAd();
	};

	actionStack.push({
		id: "changelog",
		action: $page.hide,
	});

	async function loadLatestRelease() {
		try {
			const releases = await fsOperation(`${GITHUB_API_URL}/latest`).readFile(
				"json",
			);
			selectedVersion = releases.tag_name.replace("v", "");
			selectedStatus = "latest";
			updateVersionSelector();
			return renderChangelog(releases.body);
		} catch (error) {
			toast("Failed to load latest release notes");
			renderChangelog(changelogMd.default);
		}
	}

	async function loadBetaRelease() {
		try {
			const releases = await fsOperation(GITHUB_API_URL).readFile("json");
			const betaRelease = releases.find((r) => r.prerelease);
			if (!betaRelease) {
				body.content = <div className="error">No beta release found</div>;
				return;
			}
			selectedVersion = betaRelease.tag_name.replace("v", "");
			selectedStatus = "prerelease";
			updateVersionSelector();
			return renderChangelog(betaRelease.body);
		} catch (error) {
			toast("Failed to load beta release notes");
			renderChangelog(changelogMd.default);
		}
	}

	async function loadFullChangelog() {
		try {
			const changeLogText =
				await fsOperation(CHANGELOG_FILE_URL).readFile("utf8");
			const cleanedText = changeLogText.replace(/^#\s*Change\s*Log\s*\n*/i, "");
			selectedVersion = "Changelogs.md";
			selectedStatus = "current";
			updateVersionSelector();
			return renderChangelog(cleanedText);
		} catch (error) {
			toast("Failed to load full changelog");
			renderChangelog(changelogMd.default);
		}
	}

	async function loadVersionChangelog() {
		try {
			const releases = await fsOperation(GITHUB_API_URL).readFile("json");
			const currentRelease = releases.find(
				(r) => r.tag_name.replace("v", "") === currentVersion,
			);
			selectedVersion = currentVersion;
			selectedStatus = "current";
			updateVersionSelector();
			if (currentRelease) {
				return renderChangelog(currentRelease.body);
			} else {
				return loadLatestRelease();
			}
		} catch (error) {
			toast("Failed to load version changelog");
			renderChangelog(changelogMd.default);
		}
	}

	function renderChangelog(text) {
		const md = markdownIt({ html: true, linkify: true });
		const REPO_URL = "https://github.com/Acode-Foundation/Acode";
		let processedText = text
			// Convert full PR URLs to #number format with links preserved in markdown
			.replace(
				/https:\/\/github\.com\/Acode-Foundation\/Acode\/pull\/(\d+)/g,
				`[#$1](${REPO_URL}/pull/$1)`,
			)
			// Convert existing #number references to links if they aren't already
			.replace(/(?<!\[)#(\d+)(?!\])/g, `[#$1](${REPO_URL}/pull/$1)`)
			// Convert @username mentions to GitHub profile links
			.replace(/@(\w+)/g, "[@$1](https://github.com/$1)");

		md.use(markdownItTaskLists);
		md.use(markdownItFootnote);
		body.innerHTML = md.render(processedText);
	}

	function updateVersionSelector() {
		versionTextRef.textContent = selectedVersion;
		versionIndicatorRef.className = "status-indicator status-" + selectedStatus;
	}

	async function menuClickHandler(e) {
		const action = e.target.closest("li")?.getAttribute("action");
		if (!action) return;
		versionSelectorMenu.hide();

		switch (action) {
			case "current":
				await loadVersionChangelog();
				break;
			case "latest":
				await loadLatestRelease();
				break;
			case "beta":
				await loadBetaRelease();
				break;
			case "full":
				await loadFullChangelog();
				break;
		}
	}
}
