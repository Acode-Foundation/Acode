import "./welcome.scss";
import Logo from "components/logo";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
import EditorFile from "lib/editorFile";

/**
 * Opens the Welcome tab as an EditorFile page
 */
export default function openWelcomeTab() {
	// Check if welcome tab is already open
	const existingFile = editorManager.files.find((f) => f.id === "welcome-tab");
	if (existingFile) {
		existingFile.makeActive();
		return;
	}

	const welcomeContent = createWelcomeContent();

	const welcomeFile = new EditorFile("Welcome", {
		id: "welcome-tab",
		render: true,
		type: "page",
		content: welcomeContent,
		tabIcon: "icon acode",
		hideQuickTools: true,
	});

	// Set custom subtitle for the header
	welcomeFile.setCustomTitle(() => "Get Started");

	actionStack.push({
		id: "welcome-tab",
		action: () => welcomeFile.remove(),
	});
}

/**
 * Creates the welcome tab content
 * @returns {HTMLElement}
 */
function createWelcomeContent() {
	return (
		<div id="welcome-tab" className="welcome-page scroll">
			{/* Hero Section */}
			<header className="welcome-header">
				<Logo />
				<div className="welcome-header-text">
					<h1>Welcome to Acode</h1>
					<p className="tagline">Powerful code editor for Android</p>
				</div>
			</header>

			{/* Get Started Section */}
			<section className="welcome-section">
				<h2 className="section-label">GET STARTED</h2>
				<div className="action-list">
					<ActionRow
						icon="add"
						label={strings["new file"]}
						shortcut="Ctrl+N"
						onClick={() => acode.exec("new-file")}
					/>
					<ActionRow
						icon="folder_open"
						label={strings["open folder"]}
						shortcut="Ctrl+O"
						onClick={() => acode.exec("open-folder")}
					/>
					<ActionRow
						icon="historyrestore"
						label={strings.recent}
						onClick={() => acode.exec("recent")}
					/>
					<ActionRow
						icon="tune"
						label={strings["command palette"]}
						shortcut="Ctrl+Shift+P"
						onClick={() => acode.exec("command-palette")}
					/>
				</div>
			</section>

			{/* Configure Section */}
			<section className="welcome-section">
				<h2 className="section-label">CONFIGURE</h2>
				<div className="action-list">
					<ActionRow
						icon="settings"
						label={strings.settings}
						onClick={() => acode.exec("open", "settings")}
					/>
					<ActionRow
						icon="color_lenspalette"
						label={strings["change theme"]}
						onClick={() => acode.exec("change-app-theme")}
					/>
					<ActionRow
						icon="extension"
						label={strings.explore + " " + strings.plugins}
						onClick={() => acode.exec("open", "plugins")}
					/>
				</div>
			</section>

			{/* Learn Section */}
			<section className="welcome-section">
				<h2 className="section-label">LEARN</h2>
				<div className="action-list">
					<ActionRow
						icon="help"
						label={strings.help}
						onClick={() => acode.exec("open", "help")}
					/>
					<ActionRow
						icon="info_outline"
						label={strings.about}
						onClick={() => acode.exec("open", "about")}
					/>
				</div>
			</section>

			{/* Links Section */}
			<section className="welcome-section welcome-links">
				<h2 className="section-label">CONNECT</h2>
				<div className="link-row">
					<LinkItem icon="acode" label="Website" url={constants.WEBSITE_URL} />
					<LinkItem icon="github" label="GitHub" url={constants.GITHUB_URL} />
					<LinkItem
						icon="telegram"
						label="Telegram"
						url={constants.TELEGRAM_URL}
					/>
					<LinkItem
						icon="discord"
						label="Discord"
						url={constants.DISCORD_URL}
					/>
				</div>
			</section>
		</div>
	);
}

/**
 * Action row component
 */
function ActionRow({ icon, label, shortcut, onClick }) {
	return (
		<div className="action-row" onclick={onClick}>
			<span className={`icon ${icon}`}></span>
			<span className="action-label">{label}</span>
			{shortcut && <span className="action-shortcut">{shortcut}</span>}
		</div>
	);
}

/**
 * Link item component - opens URL in external browser
 */
function LinkItem({ icon, label, url }) {
	const handleClick = (e) => {
		e.preventDefault();
		system.openInBrowser(url);
	};

	return (
		<a href={url} className="link-item" onclick={handleClick}>
			<span className={`icon ${icon}`}></span>
			<span>{label}</span>
		</a>
	);
}
