import "./plugin.scss";
import fsOperation from "fileSystem";
import ajax from "@deadlyjack/ajax";
import Page from "components/page";
import alert from "dialogs/alert";
import loader from "dialogs/loader";
import purchaseListener from "handlers/purchase";
import actionStack from "lib/actionStack";
import constants from "lib/constants";
import installPlugin from "lib/installPlugin";
import InstallState from "lib/installState";
import settings from "lib/settings";
import markdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import markdownItFootnote from "markdown-it-footnote";
import MarkdownItGitHubAlerts from "markdown-it-github-alerts";
import markdownItTaskLists from "markdown-it-task-lists";
import helpers from "utils/helpers";
import Url from "utils/Url";
import view from "./plugin.view.js";

let $lastPluginPage;

/**
 * Plugin page
 * @param {string} id
 * @param {boolean} installed
 * @param {() => void} [onInstall]
 * @param {() => void} [onUninstall]
 * @param {boolean} [installOnRender]
 */
export default async function PluginInclude(
	id,
	installed,
	onInstall,
	onUninstall,
	installOnRender,
) {
	if ($lastPluginPage) {
		$lastPluginPage.hide();
	}

	installed = typeof installed !== "boolean" ? installed === "true" : installed;
	const $page = Page(strings["plugin"]);
	let plugin = {};
	let currentVersion = "";
	let purchased = false;
	let cancelled = false;
	let update = false;
	let isPaid = false;
	let price;
	let product;
	let purchaseToken;
	let $settingsIcon;
	let minVersionCode = -1;

	actionStack.push({
		id: "plugin",
		action: $page.hide,
	});

	$page.onhide = function () {
		helpers.hideAd();
		actionStack.remove("plugin");
		loader.removeTitleLoader();
		cancelled = true;
		$lastPluginPage = null;
	};

	$lastPluginPage = $page;
	app.append($page);
	helpers.showAd();

	try {
		if (installed) {
			const manifest = Url.join(PLUGIN_DIR, id, "plugin.json");
			const installedPlugin = await fsOperation(manifest)
				.readFile("json")
				.catch((err) => {
					alert(`Failed to load plugin metadata: ${manifest}`);
					console.error(err);
				});
			const { author } = installedPlugin;
			const readme = Url.join(
				PLUGIN_DIR,
				id,
				installedPlugin.readme || "readme.md",
			);
			const description = await fsOperation(readme)
				.readFile("utf8")
				.catch((err) => {
					alert(`Failed to load plugin readme: ${readme}`);
					console.error(err);
				});
			let changelogs = "";
			if (installedPlugin.changelogs) {
				const changelogPath = Url.join(
					PLUGIN_DIR,
					id,
					installedPlugin.changelogs,
				);
				const changelogExists = await fsOperation(changelogPath).exists();
				if (changelogExists) {
					changelogs = await fsOperation(changelogPath).readFile("utf8");
				}
			}

			const iconUrl = await helpers.toInternalUri(
				Url.join(PLUGIN_DIR, id, installedPlugin.icon),
			);
			const iconData = await fsOperation(iconUrl).readFile();
			const icon = URL.createObjectURL(
				new Blob([iconData], { type: "image/png" }),
			);
			plugin = {
				id,
				icon,
				name: installedPlugin.name,
				version: installedPlugin.version,
				author: author.name,
				author_github: author.github,
				source: installedPlugin.source,
				license: installedPlugin.license,
				keywords: installedPlugin.keywords,
				contributors: installedPlugin.contributors,
				repository: installedPlugin.repository,
				description,
				changelogs,
			};

			isPaid = installedPlugin.price > 0;
			$page.settitle(plugin.name);
			render();
		}

		await (async () => {
			try {
				loader.showTitleLoader();
				if ((await helpers.checkAPIStatus()) && isValidSource(plugin.source)) {
					const remotePlugin = await fsOperation(
						constants.API_BASE,
						`plugin/${id}`,
					)
						.readFile("json")
						.catch(() => null);

					if (cancelled || !remotePlugin) return;

					if (installed && remotePlugin?.version !== plugin.version) {
						currentVersion = plugin.version;
						update = true;
					}

					if (remotePlugin.min_version_code) {
						minVersionCode = remotePlugin.min_version_code;
					}

					plugin = Object.assign({}, remotePlugin);

					if (!Number.parseFloat(remotePlugin.price)) return;

					isPaid = remotePlugin.price > 0;
					try {
						[product] = await helpers.promisify(iap.getProducts, [
							remotePlugin.sku,
						]);
						if (product) {
							const purchase = await getPurchase(product.productId);
							purchased = !!purchase;
							price = product.price;
							purchaseToken = purchase?.purchaseToken;
						}
					} catch (error) {
						helpers.error(error);
					}
				}
			} catch (error) {
				console.error(error);
			} finally {
				loader.removeTitleLoader();
			}
		})();

		$page.settitle(plugin.name);
		render();

		if (installOnRender && !installed) {
			const $button = $page.get('[data-type="install"], [data-type="buy"]');
			$button?.click();
		}
	} catch (err) {
		console.error(err);
		helpers.error(err);
	} finally {
		loader.removeTitleLoader();
	}

	async function install() {
		try {
			await Promise.all([
				loadAd(this),
				installPlugin(plugin.source || id, plugin.name, purchaseToken),
			]);
			if (onInstall) onInstall(plugin);
			installed = true;
			update = false;
			if (!plugin.price && IS_FREE_VERSION && (await window.iad?.isLoaded())) {
				window.iad.show();
			}
			render();
		} catch (err) {
			window.log("error", err);
			helpers.error(err);
		}
	}

	async function uninstall() {
		try {
			const pluginDir = Url.join(PLUGIN_DIR, plugin.id);
			const state = await InstallState.new(plugin.id);
			await Promise.all([
				loadAd(this),
				fsOperation(pluginDir).delete(),
				state.delete(state.storeUrl),
			]);
			acode.unmountPlugin(plugin.id);
			if (onUninstall) onUninstall(plugin.id);
			installed = false;
			update = false;
			if (!plugin.price && IS_FREE_VERSION && (await window.iad?.isLoaded())) {
				window.iad.show();
			}
			render();
		} catch (err) {
			window.log("error", err);
			helpers.error(err);
		}
	}

	async function buy(e) {
		const $button = e.target;
		const oldText = $button.textContent;

		try {
			if (!product) throw new Error("Product not found");
			const apiStatus = await helpers.checkAPIStatus();

			if (!apiStatus) {
				alert(strings.error, strings.api_error);
				return;
			}

			iap.setPurchaseUpdatedListener(...purchaseListener(onpurchase, onerror));
			$button.textContent = strings["loading..."];
			await helpers.promisify(iap.purchase, product.productId);

			async function onpurchase(e) {
				const purchase = await getPurchase(product.productId);
				await ajax.post(Url.join(constants.API_BASE, "plugin/order"), {
					data: {
						id: plugin.id,
						token: purchase?.purchaseToken,
						package: BuildInfo.packageName,
					},
				});
				purchaseToken = purchase?.purchaseToken;
				purchased = !!purchase;
				$button.textContent = oldText;
				install();
			}

			async function onerror(error) {
				helpers.error(error);
				$button.textContent = oldText;
			}
		} catch (error) {
			window.log("error", "Failed to buy:");
			window.log("error", error);
			helpers.error(error);
			$button.textContent = oldText;
		}
	}

	async function refund(e) {
		const $button = e.target;
		const oldText = $button.textContent;
		try {
			if (!product) throw new Error("Product not found");
			$button.textContent = strings["loading..."];
			const { refer, refunded, error } = await ajax.post(
				Url.join(constants.API_BASE, "plugin/refund"),
				{
					data: {
						id: plugin.id,
						package: BuildInfo.packageName,
						token: purchaseToken,
					},
				},
			);
			if (refer) {
				system.openInBrowser(refer);
				return;
			}

			if (refunded) {
				toast(strings.success);
				if (installed) uninstall();
				else render();
				return;
			}

			toast(error || strings.error);
		} catch (error) {
			window.log("error", error);
			helpers.error(error);
		} finally {
			$button.textContent = oldText;
		}
	}

	async function render() {
		const pluginSettings = settings.uiSettings[`plugin-${plugin.id}`];
		$page.body = view({
			...plugin,
			body: markdownIt({
				html: true,
				xhtmlOut: true,
			})
				.use(MarkdownItGitHubAlerts)
				.use(anchor, {
					slugify: (s) =>
						s
							.trim()
							.toLowerCase()
							.replace(/[^a-z0-9]+/g, "-"),
				})
				.use(markdownItTaskLists)
				.use(markdownItFootnote)
				.render(plugin.description),
			changelogs: plugin.changelogs
				? markdownIt({ html: true, xhtmlOut: true })
						.use(MarkdownItGitHubAlerts)
						.use(anchor, {
							slugify: (s) =>
								s
									.trim()
									.toLowerCase()
									.replace(/[^a-z0-9]+/g, "-"),
						})
						.use(markdownItTaskLists)
						.use(markdownItFootnote)
						.render(plugin.changelogs)
				: null,
			purchased,
			installed,
			update,
			isPaid,
			price,
			buy,
			refund,
			install,
			uninstall,
			currentVersion,
			minVersionCode,
		});

		// Handle anchor links
		$page.body.querySelectorAll("a[href^='#']").forEach((link) => {
			const originalHref = link.getAttribute("href");
			link.setAttribute("data-href", originalHref);
			link.style.cursor = "pointer";
			// Remove default click behavior
			link.removeAttribute("href");

			// Add custom click handler
			link.addEventListener(
				"click",
				(e) => {
					e.preventDefault();
					e.stopPropagation();

					const hash = link.getAttribute("data-href") || link.textContent;
					const targetId = hash.startsWith("#") ? hash.slice(1) : hash;

					// Look for either the anchor link or a heading with matching id
					const targetElement =
						$page.body.querySelector(`[name="${targetId}"]`) ||
						$page.body.querySelector(`#${targetId}`);

					if (targetElement) {
						const headerOffset =
							document.querySelector("header")?.offsetHeight || 0;
						const elementPosition = targetElement.getBoundingClientRect().top;
						const offsetPosition = elementPosition - headerOffset;

						$page.body.scrollBy({
							top: offsetPosition,
							behavior: "smooth",
						});
					}

					return false;
				},
				{ capture: true },
			);
		});

		// add copy button to code blocks
		const codeBlocks = $page.body.querySelectorAll("pre");
		codeBlocks.forEach((pre) => {
			pre.style.position = "relative";
			const copyButton = document.createElement("button");
			copyButton.className = "copy-button";
			copyButton.textContent = "Copy";

			const codeElement = pre.querySelector("code");
			if (codeElement) {
				const langMatch = codeElement.className.match(
					/language-(\w+)|(javascript)/,
				);
				if (langMatch) {
					const langMap = {
						bash: "sh",
						shell: "sh",
					};
					const lang = langMatch[1] || langMatch[2];
					const mappedLang = langMap[lang] || lang;
					const highlight = ace.require("ace/ext/static_highlight");
					highlight(codeElement, {
						mode: `ace/mode/${mappedLang}`,
						theme: settings.value.editorTheme.startsWith("ace/theme/")
							? settings.value.editorTheme
							: "ace/theme/" + settings.value.editorTheme,
					});
				}
			}

			copyButton.addEventListener("click", async () => {
				const code = pre.querySelector("code")?.textContent || pre.textContent;
				try {
					cordova.plugins.clipboard.copy(code);
					copyButton.textContent = "Copied!";
					setTimeout(() => {
						copyButton.textContent = "Copy";
					}, 2000);
				} catch (err) {
					copyButton.textContent = "Failed to copy";
					setTimeout(() => {
						copyButton.textContent = "Copy";
					}, 2000);
				}
			});

			pre.appendChild(copyButton);
		});

		if ($settingsIcon) {
			$settingsIcon.remove();
			$settingsIcon = null;
		}

		if (pluginSettings) {
			pluginSettings.setTitle(plugin.name);
			$settingsIcon = (
				<span
					attr-action="settings"
					className="icon settings"
					onclick={() => pluginSettings.show()}
				></span>
			);
			if (!$page.header.contains($settingsIcon)) {
				$page.header.append($settingsIcon);
			}
		}
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
		} catch (error) {}
	}

	async function getPurchase(sku) {
		const purchases = await helpers.promisify(iap.getPurchases);
		const purchase = purchases.find((p) => p.productIds.includes(sku));
		return purchase;
	}
}

function isValidSource(source) {
	return source
		? source.startsWith(Url.join(constants.API_BASE, "plugin"))
		: true;
}
