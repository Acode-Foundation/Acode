import "./style.scss";

import fsOperation from "fileSystem";
import ajax from "@deadlyjack/ajax";
import collapsableList from "components/collapsableList";
import Sidebar from "components/sidebar";
import alert from "dialogs/alert";
import prompt from "dialogs/prompt";
import select from "dialogs/select";
import purchaseListener from "handlers/purchase";
import constants from "lib/constants";
import InstallState from "lib/installState";
import loadPlugin from "lib/loadPlugin";
import settings from "lib/settings";
import FileBrowser from "pages/fileBrowser";
import plugin from "pages/plugin";
import helpers from "utils/helpers";
import Url from "utils/Url";

/** @type {HTMLElement} */
let $installed = null;
/** @type {HTMLElement} */
let $explore = null;
/** @type {HTMLElement} */
let container = null;
/** @type {HTMLElement} */
let $searchResult = null;

const LIMIT = 50;
let currentPage = 1;
let hasMore = true;
let isLoading = false;
let currentFilter = null;
let filterCurrentPage = 1;
let filterHasMore = true;
let isFilterLoading = false;

const $header = (
	<div className="header">
		<div className="title">
			<span>{strings.plugins}</span>
			<div className="actions">
				<button type="button" className="icon-button" onclick={filterPlugins}>
					<span className="icon tune" />
				</button>
				<button type="button" className="icon-button" onclick={addSource}>
					<span className="icon add" />
				</button>
			</div>
		</div>
		<input
			oninput={searchPlugin}
			type="search"
			name="search-ext"
			placeholder="Search"
		/>
	</div>
);

const $style = <style></style>;
/** @type {Set<HTMLElement>} */
const $scrollableLists = new Set();

let searchTimeout = null;
let installedPlugins = [];

export default [
	"extension", // icon
	"extensions", // id
	strings.plugins, // title
	initApp, // init function
	false, // prepend
	onSelected, // onSelected function
];

/**
 * On selected handler for files app
 * @param {HTMLElement} el
 */
function onSelected(el) {
	const $scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");
	for (const $el of $scrollableLists) {
		$el.scrollTop = $el.dataset.scrollTop;
	}
}

/**
 * Initialize extension app
 * @param {HTMLElement} el
 */
function initApp(el) {
	container = el;
	container.classList.add("extensions");
	container.content = $header;

	if (!$searchResult) {
		$searchResult = <ul className="list search-result scroll" />;
		container.append($searchResult);
	}

	if (!$explore) {
		$explore = collapsableList(strings.explore);
		$explore.ontoggle = loadExplore;
		$explore.$ul.onscroll = handleScroll;
		container.append($explore);
	}

	if (!$installed) {
		$installed = collapsableList(strings.installed);
		$installed.ontoggle = loadInstalled;
		container.append($installed);
	}

	Sidebar.on("show", onSelected);
	document.head.append($style);
}

async function handleScroll(e) {
	if (isLoading || !hasMore) return;

	const { scrollTop, scrollHeight, clientHeight } = e.target;

	if (scrollTop + clientHeight >= scrollHeight - 50) {
		await loadMorePlugins();
	}
}

async function handleFilterScroll(e) {
	if (isFilterLoading || !filterHasMore || !currentFilter) return;

	const { scrollTop, scrollHeight, clientHeight } = e.target;

	if (scrollTop + clientHeight >= scrollHeight - 50) {
		await loadFilteredPlugins(currentFilter, false);
	}
}

async function loadMorePlugins() {
	try {
		isLoading = true;
		startLoading($explore);

		const response = await fetch(
			`${constants.API_BASE}/plugins?page=${currentPage}&limit=${LIMIT}`,
		);
		const newPlugins = await response.json();

		if (newPlugins.length < LIMIT) {
			hasMore = false;
		}

		installedPlugins = await listInstalledPlugins();
		const pluginElements = newPlugins.map(ListItem);
		$explore.$ul.append(...pluginElements);

		currentPage++;
		updateHeight($explore);
	} catch (error) {
		window.log("error", error);
	} finally {
		isLoading = false;
		stopLoading($explore);
	}
}

async function loadFilteredPlugins(filterName, isInitial = false) {
	if (isFilterLoading || !filterHasMore) return;

	try {
		isFilterLoading = true;

		const plugins = await getFilteredPlugins(filterName, filterCurrentPage);

		if (plugins.length < LIMIT) {
			filterHasMore = false;
		}

		installedPlugins = await listInstalledPlugins();
		const pluginElements = plugins.map(ListItem);

		if (isInitial) {
			$searchResult.append(...pluginElements);
		} else {
			$searchResult.append(...pluginElements);
		}

		filterCurrentPage++;
		updateHeight($searchResult);
	} catch (error) {
		window.log("error", "Error loading filtered plugins:");
		window.log("error", error);
	} finally {
		isFilterLoading = false;
	}
}

async function searchPlugin() {
	clearTimeout(searchTimeout);
	searchTimeout = setTimeout(async () => {
		// Clear filter when searching
		currentFilter = null;
		filterCurrentPage = 1;
		filterHasMore = true;
		isFilterLoading = false;
		$searchResult.onscroll = null;

		$searchResult.content = "";
		const status = helpers.checkAPIStatus();
		if (!status) {
			$searchResult.content = (
				<span className="error">{strings.api_error}</span>
			);
			return;
		}

		const query = this.value;
		if (!query) return;

		try {
			$searchResult.classList.add("loading");
			const plugins = await fsOperation(
				Url.join(constants.API_BASE, `plugins?name=${query}`),
			).readFile("json");

			installedPlugins = await listInstalledPlugins();
			$searchResult.content = plugins.map(ListItem);
			updateHeight($searchResult);
		} catch (error) {
			window.log("error", error);
			$searchResult.content = <span className="error">{strings.error}</span>;
		} finally {
			$searchResult.classList.remove("loading");
		}
	}, 500);
}

async function filterPlugins() {
	const filterOptions = {
		[strings.top_rated]: "top_rated",
		[strings.newly_added]: "newest",
		[strings.most_downloaded]: "downloads",
	};

	const filterName = await select("Filter", Object.keys(filterOptions));
	if (!filterName) return;

	$searchResult.content = "";
	const filterParam = filterOptions[filterName];
	currentFilter = filterParam;
	filterCurrentPage = 1;
	filterHasMore = true;
	isFilterLoading = false;

	try {
		$searchResult.classList.add("loading");
		const filterMessage = (
			<div className="filter-message">
				<span>
					Filtered by <strong>{filterName}</strong>
				</span>
				<span
					className="icon clearclose close-button"
					data-action="clear-filter"
					onclick={() => clearFilter()}
				/>
			</div>
		);
		$searchResult.content = [filterMessage];
		$searchResult.onscroll = handleFilterScroll;
		await loadFilteredPlugins(filterParam, true);
		updateHeight($searchResult);

		function clearFilter() {
			currentFilter = null;
			filterCurrentPage = 1;
			filterHasMore = true;
			isFilterLoading = false;
			$searchResult.content = "";
			$searchResult.onscroll = null;
			updateHeight($searchResult);
		}
	} catch (error) {
		window.log("error", "Error filtering plugins:");
		window.log("error", error);
		$searchResult.content = <span className="error">{strings.error}</span>;
	} finally {
		$searchResult.classList.remove("loading");
	}
}

async function addSource() {
	const sourceOption = [
		["remote", strings.remote],
		["local", strings.local],
	];
	const sourceType = await select("Select Source", sourceOption);

	if (!sourceType) return;
	let source;
	if (sourceType === "remote") {
		source = await prompt("Enter plugin source", "https://", "url");
	} else {
		source = (await FileBrowser("file", "Select plugin source")).url;
	}

	if (!source) return;

	try {
		const { default: installPlugin } = await import("lib/installPlugin");
		await installPlugin(source);
		if (!$explore.collapsed) {
			$explore.ontoggle();
		}
		if (!$installed.collapsed) {
			$installed.ontoggle();
		}
	} catch (error) {
		console.error(error);
		window.toast(helpers.errorMessage(error));
		addSource(sourceType, source);
	}
}

async function loadInstalled() {
	if (this.collapsed) return;

	const plugins = await listInstalledPlugins();
	if (!plugins.length) {
		$installed.collapse();
	}
	$installed.$ul.content = plugins.map(ListItem);
	updateHeight($installed);
}

async function loadExplore() {
	if (this.collapsed) return;

	const status = helpers.checkAPIStatus();
	if (!status) {
		$explore.$ul.content = <span className="error">{strings.api_error}</span>;
		return;
	}

	try {
		startLoading($explore);
		currentPage = 1;
		hasMore = true;

		const response = await fetch(
			`${constants.API_BASE}/plugins?page=${currentPage}&limit=${LIMIT}`,
		);
		const plugins = await response.json();

		if (plugins.length < LIMIT) {
			hasMore = false;
		}

		installedPlugins = await listInstalledPlugins();
		$explore.$ul.content = plugins.map(ListItem);
		currentPage++;
		updateHeight($explore);
	} catch (error) {
		$explore.$ul.content = <span className="error">{strings.error}</span>;
	} finally {
		stopLoading($explore);
	}
}

async function listInstalledPlugins() {
	const plugins = await Promise.all(
		(await fsOperation(PLUGIN_DIR).lsDir()).map(async (item) => {
			const id = Url.basename(item.url);
			const url = Url.join(item.url, "plugin.json");
			const plugin = await fsOperation(url).readFile("json");
			const iconUrl = getLocalRes(id, plugin.icon);
			plugin.icon = await helpers.toInternalUri(iconUrl);
			plugin.installed = true;
			return plugin;
		}),
	);
	return plugins;
}

async function getFilteredPlugins(filterName, page = 1) {
	try {
		let response;
		if (filterName === "top_rated") {
			response = await fetch(
				`${constants.API_BASE}/plugins?explore=random&page=${page}&limit=${LIMIT}`,
			);
		} else {
			response = await fetch(
				`${constants.API_BASE}/plugin?orderBy=${filterName}&page=${page}&limit=${LIMIT}`,
			);
		}
		return await response.json();
	} catch (error) {
		window.log("error", error);
		return [];
	}
}

function startLoading($list) {
	$list.$title.classList.add("loading");
}

function stopLoading($list) {
	$list.$title.classList.remove("loading");
}

/**
 * Update the height of the element
 * @param {HTMLElement} $el
 */
function updateHeight($el) {
	removeHeight($installed, $el !== $installed);
	removeHeight($explore, $el !== $explore);

	try {
		let height = $header?.getBoundingClientRect().height;
		const tileHeight = $el.get(":scope>.tile")?.getBoundingClientRect().height;
		if ($el === $searchResult) {
			height += 60;
		} else {
			height += $searchResult?.getBoundingClientRect().height + tileHeight;
		}

		setHeight($el, height);
	} catch (error) {
		console.error(error);
	}
}

/**
 * Remove height styles from an element
 * @param {HTMLElement} $el
 * @param {Boolean} collapse
 */
function removeHeight($el, collapse = false) {
	if (collapse) $el.collapse?.();

	$scrollableLists.delete($el);
	updateStyle();
}

/**
 * Change the height of an element
 * @param {HTMLElement} $el
 * @param {Number} height
 */
function setHeight($el, height) {
	$scrollableLists.add($el);

	const calcHeight = height ? `calc(100% - ${height}px)` : "100%";
	$el.dataset.height = calcHeight;
	if ($el === $searchResult) {
		$el.style.height = "fit-content";
		return;
	}

	updateStyle();
}

function updateStyle() {
	let style = "";

	$scrollableLists.forEach(($el) => {
		style += `
			.list.collapsible[data-id="${$el.dataset.id}"] {
				max-height: ${$el.dataset.height} !important;
			}
		`;
	});

	$style.innerHTML = style;
}

function getLocalRes(id, name) {
	return Url.join(PLUGIN_DIR, id, name);
}

function ListItem({ icon, name, id, version, downloads, installed, source }) {
	if (installed === undefined) {
		installed = !!installedPlugins.find(({ id: _id }) => _id === id);
	}
	const disabledMap = settings.value.pluginsDisabled || {};
	const enabled = disabledMap[id] !== true;
	const $el = (
		<div
			data-plugin-id={id}
			data-plugin-enabled={enabled !== false}
			className="tile"
			style={enabled === false ? { opacity: 0.6 } : {}}
		>
			<span className="icon" style={{ backgroundImage: `url(${icon})` }} />
			<span
				className="text sub-text"
				data-subtext={`v${version} • ${installed ? `${strings.installed}` : helpers.formatDownloadCount(downloads)}`}
			>
				{name}
			</span>
			{installed
				? <>
						{source
							? <span className="icon replay" data-action="rebuild-plugin" />
							: null}
						<span className="icon more_vert" data-action="more-plugin-action" />
					</>
				: <button
						type="button"
						className="install-btn"
						data-action="install-plugin"
					>
						<span className="icon file_downloadget_app" />
					</button>}
		</div>
	);

	$el.onclick = async (event) => {
		const morePluginActionButton = event.target.closest(
			'[data-action="more-plugin-action"]',
		);
		const installPluginBtn = event.target.closest(
			'[data-action="install-plugin"]',
		);
		const rebuildPluginBtn = event.target.closest(
			'[data-action="rebuild-plugin"]',
		);
		if (morePluginActionButton) {
			more_plugin_action(id, name);
			return;
		}
		if (installPluginBtn) {
			try {
				let purchaseToken;
				let product;
				const pluginUrl = Url.join(constants.API_BASE, `plugin/${id}`);
				const remotePlugin = await fsOperation(pluginUrl)
					.readFile("json")
					.catch(() => {
						throw new Error("Failed to fetch plugin details");
					});

				const isPaid = remotePlugin.price > 0;
				if (isPaid) {
					[product] = await helpers.promisify(iap.getProducts, [
						remotePlugin.sku,
					]);
					if (product) {
						const purchase = await getPurchase(product.productId);
						purchaseToken = purchase?.purchaseToken;
					}
				}

				if (isPaid && !purchaseToken) {
					if (!product) throw new Error("Product not found");
					const apiStatus = await helpers.checkAPIStatus();

					if (!apiStatus) {
						alert(strings.error, strings.api_error);
						return;
					}

					iap.setPurchaseUpdatedListener(
						...purchaseListener(onpurchase, onerror),
					);
					await helpers.promisify(iap.purchase, product.productId);

					async function onpurchase(e) {
						const purchase = await getPurchase(product.productId);
						await ajax.post(Url.join(constants.API_BASE, "plugin/order"), {
							data: {
								id: remotePlugin.id,
								token: purchase?.purchaseToken,
								package: BuildInfo.packageName,
							},
						});
						purchaseToken = purchase?.purchaseToken;
					}

					async function onerror(error) {
						throw error;
					}
				}

				const { default: installPlugin } = await import("lib/installPlugin");
				await installPlugin(
					id,
					remotePlugin.name,
					purchaseToken ? purchaseToken : undefined,
				);

				const searchInput = container.querySelector('input[name="search-ext"]');
				if (searchInput) {
					searchInput.value = "";
					$searchResult.content = "";
					// Reset filter state when clearing search results
					currentFilter = null;
					filterCurrentPage = 1;
					filterHasMore = true;
					isFilterLoading = false;
					$searchResult.onscroll = null;
					updateHeight($searchResult);
					$installed.expand();
				}

				window.toast(strings.success, 3000);
				if (!$explore.collapsed) {
					$explore.ontoggle();
				}
				if (!$installed.collapsed) {
					$installed.ontoggle();
				}

				async function getPurchase(sku) {
					const purchases = await helpers.promisify(iap.getPurchases);
					const purchase = purchases.find((p) => p.productIds.includes(sku));
					return purchase;
				}
			} catch (err) {
				console.error(err);
				window.toast(helpers.errorMessage(err), 3000);
			}
			return;
		}
		if (rebuildPluginBtn) {
			try {
				const { default: installPlugin } = await import("lib/installPlugin");
				await installPlugin(source);
				window.toast(strings.success, 3000);
			} catch (err) {
				console.error(err);
				window.toast(helpers.errorMessage(err), 3000);
			}
			return;
		}

		plugin(
			{ id, installed },
			() => {
				if (!$explore.collapsed) {
					$explore.ontoggle();
				}
				if (!$installed.collapsed) {
					$installed.ontoggle();
				}
			},
			() => {
				if (!$explore.collapsed) {
					$explore.ontoggle();
				}
				if (!$installed.collapsed) {
					$installed.ontoggle();
				}
			},
		);
	};

	return $el;
}

async function loadAd(el) {
	if (!IS_FREE_VERSION) return;
	try {
		if (!(await window.iad?.isLoaded())) {
			const oldText = el.textContent;
			el.textContent = strings["loading..."];
			await window.iad.load();
			el.textContent = oldText;
		}
	} catch (error) {
		console.error(error);
	}
}

async function uninstall(id) {
	try {
		const pluginDir = Url.join(PLUGIN_DIR, id);
		const state = await InstallState.new(id);
		await Promise.all([
			loadAd(this),
			fsOperation(pluginDir).delete(),
			state.delete(state.storeUrl),
		]);
		acode.unmountPlugin(id);

		const searchInput = container.querySelector('input[name="search-ext"]');
		if (searchInput) {
			searchInput.value = "";
			$searchResult.content = "";
			// Reset filter state when clearing search results
			currentFilter = null;
			filterCurrentPage = 1;
			filterHasMore = true;
			isFilterLoading = false;
			$searchResult.onscroll = null;
			updateHeight($searchResult);
			if ($installed.collapsed) {
				$installed.expand();
			}
		}

		// Show Ad If Its Free Version, interstitial Ad(iad) is loaded.
		if (IS_FREE_VERSION && (await window.iad?.isLoaded())) {
			window.iad.show();
		}
	} catch (err) {
		helpers.error(err);
	}
}

async function more_plugin_action(id, pluginName) {
	const disabledMap = settings.value.pluginsDisabled || {};
	const enabled = disabledMap[id] !== true;
	let actions = [];
	const pluginSettings = settings.uiSettings[`plugin-${id}`];

	if (pluginSettings) {
		actions.push(strings.settings);
	}

	actions.push(
		enabled ? strings.disable || "Disable" : strings.enable || "Enable",
	);

	actions.push(strings.uninstall);
	const action = await select("Action", actions);
	if (!action) return;
	switch (action) {
		case strings.settings:
			pluginSettings.setTitle(pluginName);
			pluginSettings.show();
			break;
		case strings.uninstall:
			await uninstall(id);
			if (!$explore.collapsed) {
				$explore.ontoggle();
			}
			if (!$installed.collapsed) {
				$installed.ontoggle();
			}
			break;
		case strings.disable || "Disable":
		// fallthrough
		case strings.enable || "Enable":
			if (enabled) {
				disabledMap[id] = true; // Disabling
			} else {
				delete disabledMap[id]; // Enabling
			}

			settings.update({ pluginsDisabled: disabledMap }, false);

			// INFO: I don't know how to get all loaded plugins(not installed).
			const choice = await select(
				strings.info,
				[
					// { value: "reload_plugins", text: strings["reload_plugins"] || "Reload Plugins" },
					{
						value: "restart_app",
						text: strings["restart_app"] || "Restart App",
					},
					{
						value: "single",
						text: enabled
							? strings["disable_plugin"] || "Disable this Plugin"
							: strings["enable_plugin"] || "Enable this Plugin",
					},
				],
				{
					default: "single",
				},
			);

			// if (choice === "reload_plugins") {
			// 	// Unmount all currently loaded plugins before reloading
			// 	if (window.acode && typeof window.acode.getLoadedPluginIds === "function") {
			// 		for (const pluginId of window.acode.getLoadedPluginIds()) {
			// 			window.acode.unmountPlugin(pluginId);
			// 		}
			// 	}
			// 	await window.loadPlugins?.();
			// 	window.toast(strings.success);
			// }
			if (choice === "restart_app") {
				location.reload();
			} else if (choice === "single") {
				if (enabled) {
					window.acode.unmountPlugin(id);
					window.toast(strings["plugin_disabled"] || "Plugin Disabled");
				} else {
					await loadPlugin(id);
					window.toast(strings["plugin_enabled"] || "Plugin enabled");
				}
				if (!$explore.collapsed) {
					$explore.ontoggle();
				}
				if (!$installed.collapsed) {
					$installed.ontoggle();
				}
			}
			break;
	}
}
