import "./about.scss";
import Logo from "components/logo";
import Page from "components/page";
import Reactive from "html-tag-js/reactive";
import actionStack from "lib/actionStack";
import helpers from "utils/helpers";

export default function AboutInclude() {
	const $page = Page(strings.about.capitalize());
	const webviewVersionName = Reactive("N/A");
	const webviewPackageName = Reactive("N/A");

	$page.classList.add("about-us");
	$page.body = (
		<main id="about-page" className="main scroll">
			<Logo />

			<div className="version-info">
				<h1 className="version-title">Acode editor</h1>
				<div className="version-number">
					Version {BuildInfo.version} ({BuildInfo.versionCode})
				</div>
			</div>

			<div className="info-section">
				<a
					href="#"
					className="info-item"
					onclick={(e) => {
						e.preventDefault();
						system.openInBrowser(
							`https://play.google.com/store/apps/details?id=${webviewPackageName.value}`,
						);
					}}
				>
					<div className="info-item-icon">
						<span className="icon googlechrome"></span>
					</div>
					<div className="info-item-text">
						Webview {webviewVersionName}
						<div className="info-item-subtext">{webviewPackageName}</div>
					</div>
				</a>
				<a href="https://acode.app" className="info-item">
					<div className="info-item-icon">
						<span className="icon acode"></span>
					</div>
					<div className="info-item-text">
						Official webpage
						<div className="info-item-subtext">https://acode.app</div>
					</div>
				</a>
				<a href="https://foxbiz.io" className="info-item">
					<div className="info-item-icon">
						<span className="icon foxbiz"></span>
					</div>
					<div className="info-item-text">
						Foxbiz Software Pvt. Ltd.
						<div className="info-item-subtext">https://www.foxbiz.io</div>
					</div>
				</a>
			</div>

			<div className="social-links">
				<a href="mailto:apps@foxdebug.com" className="social-link">
					<div className="social-icon">
						<span className="icon gmail"></span>
					</div>
					Mail
				</a>
				<a href="https://x.com/foxbiz_io" className="social-link">
					<div className="social-icon">
						<span className="icon twitter"></span>
					</div>
					Twitter
				</a>
				<a href="https://www.instagram.com/foxbiz.io/" className="social-link">
					<div className="social-icon">
						<span className="icon instagram"></span>
					</div>
					Instagram
				</a>
				<a
					href="https://github.com/Acode-Foundation/Acode"
					className="social-link"
				>
					<div className="social-icon">
						<span className="icon github"></span>
					</div>
					GitHub
				</a>
				<a href="https://t.me/foxdebug_acode" className="social-link">
					<div className="social-icon">
						<span className="icon telegram"></span>
					</div>
					Telegram
				</a>
				<a href="https://discord.gg/nDqZsh7Rqz" className="social-link">
					<div className="social-icon">
						<span className="icon discord"></span>
					</div>
					Discord
				</a>
			</div>
		</main>
	);

	system.getWebviewInfo((res) => {
		webviewPackageName.value = res?.packageName || "N/A";
		webviewVersionName.value = res?.versionName || "N/A";
	});

	actionStack.push({
		id: "about",
		action: $page.hide,
	});

	$page.onhide = function () {
		actionStack.remove("about");
		helpers.hideAd();
	};

	app.append($page);
	helpers.showAd();
}
