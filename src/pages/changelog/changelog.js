import fsOperation from "fileSystem";
import "./style.scss";
import Contextmenu from "components/contextmenu";
import Page from "components/page";
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
	const versionIndicatorRef = new Ref();
	const versionTextRef = new Ref();

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

	const $content = <div className="md" id="changelog"></div>;
	$content.innerHTML = '<div class="loading">Loading changelog...</div>';
	$page.content = $content;
	app.append($page);

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
			$content.innerHTML =
				'<div class="error">Failed to load latest release notes</div>';
		}
	}

	async function loadBetaRelease() {
		try {
			const releases = await fsOperation(GITHUB_API_URL).readFile("json");
			const betaRelease = releases.find((r) => r.prerelease);
			if (!betaRelease) {
				$content.innerHTML = '<div class="error">No beta release found</div>';
				return;
			}
			selectedVersion = betaRelease.tag_name.replace("v", "");
			selectedStatus = "prerelease";
			updateVersionSelector();
			return renderChangelog(betaRelease.body);
		} catch (error) {
			$content.innerHTML =
				'<div class="error">Failed to load beta release notes</div>';
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
			$content.innerHTML =
				'<div class="error">Failed to load full changelog</div>';
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
			$content.innerHTML =
				'<div class="error">Failed to load version changelog</div>';
		}
	}

	function renderChangelog(text) {
		const md = markdownIt({ html: true, linkify: true });
		const REPO_URL = "https://github.com/Acode-Foundation/Acode";
		let processedText = text
			// Convert full PR URLs to #number format with links preserved in markdown
			.replace(
				/https:\/\/github\.com\/Acode-Foundation\/Acode\/pull\/(\d+)/g,
				"[#$1](https://github.com/Acode-Foundation/Acode/pull/$1)",
			)
			// Convert existing #number references to links if they aren't already
			.replace(
				/(?<!\[)#(\d+)(?!\])/g,
				"[#$1](https://github.com/Acode-Foundation/Acode/pull/$1)",
			)
			// Convert @username mentions to GitHub profile links
			.replace(/@(\w+)/g, "[@$1](https://github.com/$1)");

		md.use(markdownItTaskLists);
		md.use(markdownItFootnote);
		const htmlContent = md.render(processedText);
		$content.innerHTML = htmlContent;
	}

	function updateVersionSelector() {
		versionTextRef.textContent = selectedVersion;
		versionIndicatorRef.className = "status-indicator status-" + selectedStatus;
	}

	versionSelectorMenu.onclick = async function (e) {
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
	};

	// Load current version changelog by default
	loadVersionChangelog();

	$page.onhide = function () {
		actionStack.remove("changelog");
	};

	actionStack.push({
		id: "changelog",
		action: $page.hide,
	});
}
