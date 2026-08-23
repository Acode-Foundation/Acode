import "./about.scss";

import Logo from "components/logo";
import Page from "components/page";

import Reactive from "html-tag-js/reactive";

import actionStack from "lib/actionStack";
import config from "lib/config";

import helpers from "utils/helpers";

export default function AboutInclude() {
	/*
	 * Create the About page.
	 */
	const $page = Page(strings.about.capitalize());

	/*
	 * WebView information is loaded asynchronously,
	 * so these values are reactive.
	 */
	const webviewVersionName = Reactive("N/A");
	const webviewPackageName = Reactive("N/A");

	/*
	 * Social links are kept in an array so the UI
	 * can be generated without repeating the same JSX.
	 */
	const socialLinks = [
		{
			name: "Mail",
			icon: "gmail",
			href: "mailto:apps@foxdebug.com",
		},
		{
			name: "Twitter",
			icon: "twitter",
			href: config.TWITTER_URL,
		},
		{
			name: "Instagram",
			icon: "instagram",
			href: config.INSTAGRAM_URL,
		},
		{
			name: "GitHub",
			icon: "github",
			href: config.GITHUB_URL,
		},
		{
			name: "Telegram",
			icon: "telegram",
			href: config.TELEGRAM_URL,
		},
		{
			name: "Discord",
			icon: "discord",
			href: config.DISCORD_URL,
		},
	];

	/*
	 * Open the Android System WebView page
	 * on Google Play.
	 */
	const openWebviewPage = (event) => {
		event.preventDefault();

		const packageName = webviewPackageName.value;

		if (!packageName || packageName === "N/A") {
			return;
		}

		system.openInBrowser(
			`https://play.google.com/store/apps/details?id=${packageName}`,
		);
	};

	/*
	 * Open an external URL.
	 *
	 * Normal web URLs use Acode's browser API.
	 * mailto links are handled by the Android system.
	 */
	const openExternalLink = (event) => {
		event.preventDefault();

		const href =
			event.currentTarget.getAttribute("href");

		if (!href) {
			return;
		}

		if (href.startsWith("mailto:")) {
			window.location.href = href;
			return;
		}

		system.openInBrowser(href);
	};

	/*
	 * Add the About page CSS class.
	 */
	$page.classList.add("about-us");

	/*
	 * Build the About page.
	 */
	$page.body = (
		<main id="about-page" className="main scroll">

			{/* ==============================
			    HEADER
			    ============================== */}

			<section className="about-header">

				<div className="about-logo">
					<Logo />
				</div>

				<div className="about-title">
					<h1>Acode editor</h1>

					<div className="about-version">
						Version {BuildInfo.version}

						<span className="version-separator">
							•
						</span>

						{BuildInfo.versionCode}
					</div>
				</div>

			</section>

			<section className="about-content">

				{/* ==============================
				    APPLICATION INFORMATION
				    ============================== */}

				<div className="about-section">

					<div className="about-section-title">
						Application
					</div>

					<div className="info-section">

						{/* WebView */}

						<a
							href="#webview"
							className="info-item"
							onclick={openWebviewPage}
						>
							<div className="info-item-icon">
								<span className="icon googlechrome"></span>
							</div>

							<div className="info-item-text">
								<span className="info-item-title">
									WebView
								</span>

								<span className="info-item-subtext">
									{webviewVersionName}
								</span>

								<span className="info-item-package">
									{webviewPackageName}
								</span>
							</div>

							<div className="info-item-arrow">
								›
							</div>
						</a>

						{/* Official website */}

						<a
							href={config.BASE_URL}
							className="info-item"
							onclick={openExternalLink}
						>
							<div className="info-item-icon">
								<span className="icon acode"></span>
							</div>

							<div className="info-item-text">
								<span className="info-item-title">
									Official website
								</span>

								<span className="info-item-subtext">
									{config.BASE_URL}
								</span>
							</div>

							<div className="info-item-arrow">
								›
							</div>
						</a>

						{/* Foxbiz website */}

						<a
							href={config.FOXBIZ_URL}
							className="info-item"
							onclick={openExternalLink}
						>
							<div className="info-item-icon">
								<span className="icon foxbiz"></span>
							</div>

							<div className="info-item-text">
								<span className="info-item-title">
									Foxbiz Software Pvt. Ltd.
								</span>

								<span className="info-item-subtext">
									{config.FOXBIZ_URL}
								</span>
							</div>

							<div className="info-item-arrow">
								›
							</div>
						</a>

					</div>
				</div>

				{/* ==============================
				    SOCIAL LINKS
				    ============================== */}

				<div className="about-section">

					<div className="about-section-title">
						Connect with us
					</div>

					<div className="social-links">

						{socialLinks.map((social) => (
							<a
								href={social.href}
								className="social-link"
								onclick={openExternalLink}
							>
								<div className="social-icon">
									<span
										className={`icon ${social.icon}`}
									></span>
								</div>

								<span className="social-name">
									{social.name}
								</span>

								<span className="social-arrow">
									›
								</span>
							</a>
						))}

					</div>
				</div>

				{/* ==============================
				    FOOTER
				    ============================== */}

				<div className="about-footer">

					<div className="about-footer-title">
						Acode editor
					</div>

					<div className="about-footer-version">
						Version {BuildInfo.version}
					</div>

					<div className="about-footer-text">
						A powerful code editor for Android.
					</div>

				</div>

			</section>
		</main>
	);

	/*
	 * Get Android WebView information.
	 *
	 * This callback updates the reactive values,
	 * which automatically updates the UI.
	 */
	system.getWebviewInfo((res) => {
		webviewPackageName.value =
			res?.packageName || "N/A";

		webviewVersionName.value =
			res?.versionName || "N/A";
	});

	/*
	 * Add the About page to the action stack.
	 */
	actionStack.push({
		id: "about",
		action: $page.hide,
	});

	/*
	 * Remove the About page from the action stack
	 * when the page is hidden.
	 */
	$page.onhide = function () {
		actionStack.remove("about");
	};

	/*
	 * Add the page to the application.
	 */
	app.append($page);

	/*
	 * Show advertisement.
	 */
	helpers.showAd();
}
