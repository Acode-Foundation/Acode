import appSettings from "lib/settings";
import Sponsors from "pages/sponsors";
import SidebarApp from "./sidebarApp";

const SIDEBAR_APPS_LAST_SECTION = "sidebarAppsLastSection";

/**@type {HTMLElement} */
let $apps;
/**@type {HTMLElement} */
let $sidebar;
/**@type {string} */
let currentSection = localStorage.getItem(SIDEBAR_APPS_LAST_SECTION);
/**@type {SidebarApp[]} */
const apps = [];
/**@type {HTMLSpanElement | null} */
let $sponsorIcon = null;

/**
 * @param {string} icon icon of the app
 * @param {string} id id of the app
 * @param {HTMLElement} el element to show in sidebar
 * @param {string} title title of the app
 * @param {(container:HTMLElement)=>void} initFunction
 * @param {boolean} prepend weather to show this app at the top of the sidebar or not
 * @param {(container:HTMLElement)=>void} onSelected
 * @returns {void}
 */
function add(
	icon,
	id,
	title,
	initFunction,
	prepend = false,
	onSelected = () => {},
) {
	currentSection ??= id;

	const active = currentSection === id;
	const app = new SidebarApp(icon, id, title, initFunction, onSelected);

	app.active = active;
	app.install(prepend);
	apps.push(app);
}

/**
 * Removes a sidebar app with the given ID.
 * @param {string} id - The ID of the sidebar app to remove.
 * @returns {void}
 */
function remove(id) {
	const app = apps.find((app) => app.id === id);
	if (!app) return;
	const wasActive = app.active;
	app.remove();
	apps.splice(apps.indexOf(app), 1);
	if (wasActive && apps.length > 0) {
		const firstApp = apps[0];
		firstApp.active = true;
		currentSection = firstApp.id;
		localStorage.setItem(SIDEBAR_APPS_LAST_SECTION, firstApp.id);
	}
}

/**
 * Initialize sidebar apps
 * @param {HTMLElement} $el
 */
function init($el) {
	$sidebar = $el;
	$apps = $sidebar.get(".app-icons-container");
	$apps.addEventListener("click", onclick);
	SidebarApp.init($el, $apps);
	appSettings.on(
		"update:showSponsorSidebarApp",
		setSponsorSidebarAppVisibility,
	);
}

/**
 * Loads all sidebar apps.
 */
async function loadApps() {
	add(...(await import("./files")).default);
	add(...(await import("./searchInFiles")).default);
	add(...(await import("./extensions")).default);
	add(...(await import("./notification")).default);
	setSponsorSidebarAppVisibility(appSettings.value.showSponsorSidebarApp);
}

/**
 * Adds or removes the sponsor icon in sidebar based on settings.
 * @param {boolean} visible
 */
function setSponsorSidebarAppVisibility(visible) {
	if (!$apps) return;

	if (visible) {
		if ($sponsorIcon?.isConnected) return;
		$sponsorIcon = (
			<span
				className="icon favorite"
				title={strings.sponsor}
				onclick={Sponsors}
			/>
		);
		$apps.append($sponsorIcon);
		return;
	}

	if ($sponsorIcon) {
		$sponsorIcon.remove();
		$sponsorIcon = null;
	}
}

/**
 * Ensures that at least one app is active.
 * Call this AFTER all plugins have been loaded to handle cases where
 * the stored section was from an uninstalled plugin.
 * @returns {void}
 */
function ensureActiveApp() {
	const hasActiveApp = apps.some((app) => app.active);
	if (!hasActiveApp && apps.length > 0) {
		const firstApp = apps[0];
		firstApp.active = true;
		currentSection = firstApp.id;
		localStorage.setItem(SIDEBAR_APPS_LAST_SECTION, firstApp.id);
	}
}

/**
 * Gets the container of the app with the given ID.
 * @param {string} id
 * @returns
 */
function get(id) {
	const app = apps.find((app) => app.id === id);
	return app.container;
}

/**
 * Handles click on sidebar apps
 * @param {MouseEvent} e
 */
function onclick(e) {
	const target = e.target;
	const { action, id } = target.dataset;

	if (action !== "sidebar-app") return;

	localStorage.setItem(SIDEBAR_APPS_LAST_SECTION, id);
	const activeApp = apps.find((app) => app.active);
	const app = apps.find((app) => app.id === id);
	if (activeApp) activeApp.active = false;
	if (app) app.active = true;
}

export default {
	init,
	add,
	get,
	remove,
	loadApps,
	ensureActiveApp,
};
