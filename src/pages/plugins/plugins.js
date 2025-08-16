import "./plugins.scss";

import Item from "./item";
import Url from "utils/Url";
import Plugin from "pages/plugin";
import Page from "components/page";
import helpers from "utils/helpers";
import fsOperation from "fileSystem";
import constants from "lib/constants";
import TabView from "components/tabView";
import searchBar from "components/searchbar";
import FileBrowser from "pages/fileBrowser";
import installPlugin from "lib/installPlugin";
import prompt from "dialogs/prompt";
import actionStack from "lib/actionStack";
import Contextmenu from "components/contextmenu";
import settings from "lib/settings";
import loadPlugin from "lib/loadPlugin";

/**
 *
 * @param {Array<object>} updates
 */
export default function PluginsInclude(updates) {
  const $page = Page(strings["plugins"]);
  const $search = <span className="icon search" data-action="search"></span>;
  const $add = <span className="icon add" data-action="add-source"></span>;
  const $filter = <span className="icon tune" data-action="filter"></span>;
  const List = () => (
    <div
      id="plugin-list"
      className="list scroll"
      empty-msg={strings["loading..."]}
    ></div>
  );
  const $list = {
    all: <List />,
    installed: <List />,
    owned: <List />,
  };
  const plugins = {
    all: [],
    installed: [],
    owned: [],
  };
  let $currList = $list.installed;
  let currSection = "installed";
  let hideSearchBar = () => {};
  let currentPage = 1;
  let isLoading = false;
  let hasMore = true;
  let isSearching = false;
  let currentFilter = null;
  const LIMIT = 50;

  Contextmenu({
    toggler: $add,
    top: "8px",
    right: "8px",
    items: [
      [strings.remote, "remote"],
      [strings.local, "local"],
    ],
    onselect(item) {
      addSource(item);
    },
  });

  Contextmenu({
    toggler: $filter,
    top: "8px",
    right: "16px",
    items: [
      [strings.top_rated, "top_rated"],
      [strings.newly_added, "newest"],
      [strings.most_downloaded, "downloads"],
    ],
    onselect(item) {
      const filterNames = {
        top_rated: strings.top_rated,
        newest: strings.newly_added,
        downloads: strings.most_downloaded,
      };
      const filterName = filterNames[item];
      currentFilter = item;
      currentPage = 1;
      hasMore = true;
      isLoading = false;
      plugins.all = []; // Reset the all plugins array
      render("all");
      $list.all.replaceChildren();
      $list.all.append(
        <div className="filter-message">
          Filtered by <strong>{filterName}</strong>
          <span
            className="icon clearclose"
            data-action="clear-filter"
            onclick={() => {
              currentFilter = null;
              currentPage = 1;
              hasMore = true;
              isLoading = false;
              plugins.all = []; // Reset the all plugins array
              $list.all.replaceChildren();
              getAllPlugins();
            }}
          ></span>
        </div>,
      );
      getFilteredPlugins(item);
    },
  });

  $page.body = (
    <TabView id="plugins">
      <div className="options">
        <span
          id="installed_plugins"
          onclick={renderInstalled}
          tabindex="0"
          className="active"
        >
          {strings.installed}
        </span>
        <span id="all_plugins" onclick={renderAll} tabindex="0">
          {strings.all}
        </span>
        <span id="owned_plugins" onclick={renderOwned} tabindex="0">
          {strings.owned}
        </span>
      </div>
      {$list.installed}
    </TabView>
  );
  $page.header.append($search, $filter, $add);

  actionStack.push({
    id: "plugins",
    action: $page.hide,
  });

  $page.onhide = function () {
    helpers.hideAd();
    actionStack.remove("plugins");
  };

  $page.onconnect = () => {
    $currList.scrollTop = $currList._scroll || 0;
  };

  $page.onwilldisconnect = () => {
    $currList._scroll = $currList.scrollTop;
  };

  $page.ondisconnect = () => hideSearchBar();

  $page.onclick = handleClick;

  $list.all.addEventListener('scroll', async (e) => {
    if (isLoading || !hasMore || isSearching) return;

    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollTop + clientHeight >= scrollHeight - 50) {
        if (currentFilter) {
          await getFilteredPlugins(currentFilter);
        } else {
          await getAllPlugins();
        }
    }
  })

  app.append($page);
  helpers.showAd();

  if (updates) {
    $page.get(".options").style.display = "none";
    $add.style.display = "none";
    $filter.style.display = "none";
    $page.settitle(strings.update);
    getInstalledPlugins(updates).then(() => {
      render("installed");
    });
    return;
  }

  if (navigator.onLine) {
    getAllPlugins();
    getOwned();
  }

  getInstalledPlugins().then(() => {
    if (plugins.installed.length) {
      return;
    }

    render("all");
  });

  function handleClick(event) {
    const $target = event.target;
    const { action } = $target.dataset;
    if (action === "search") {
      if (currSection === "all") {
        isSearching = true;
        searchBar(
          $currList,
          (hide) => {
            hideSearchBar = hide;
            isSearching = false;
          },
          undefined,
          searchRemotely,
        );
        return;
      } else {
        isSearching = true;
        searchBar($currList, (hide) => {
          hideSearchBar = hide;
          isSearching = false;
        });
        return;
      }
    }
    if (action === "open") {
      Plugin($target.dataset, onInstall, onUninstall);
      return;
    }
  }

  function render(section) {
    if (currSection === section) return;

    if (!section) {
      section = currSection;
    }

    if (document.getElementById("search-bar")) {
      hideSearchBar();
    }

    const $section = $list[section];
    $currList._scroll = $currList.scrollTop;
    $currList.replaceWith($section);
    $section.scrollTop = $section._scroll || 0;
    $currList = $section;
    currSection = section;
    if (section === "all") {
      currentPage = 1;
      hasMore = true;
      isLoading = false;
      plugins.all = []; // Reset the all plugins array
      $list.all.replaceChildren();
      getAllPlugins();
    }
    $page.get(".options .active").classList.remove("active");
    $page.get(`#${section}_plugins`).classList.add("active");
  }

  function renderAll() {
    render("all");
  }

  function renderInstalled() {
    render("installed");
  }

  function renderOwned() {
    render("owned");
  }

  async function searchRemotely(query) {
    if (!query) return [];
    try {
      const response = await fetch(
        `${constants.API_BASE}/plugins?name=${query}`,
      );
      const plugins = await response.json();
      // Map the plugins to Item elements and return
      return plugins.map((plugin) => <Item {...plugin} />);
    } catch (error) {
      $list.all.setAttribute("empty-msg", strings["error"]);
      window.log("error", "Failed to search remotely:");
      window.log("error", error);
      return [];
    }
  }

  async function getFilteredPlugins(filterName) {
    if (isLoading || !hasMore) return;
    
    try {
      isLoading = true;
      $list.all.setAttribute("empty-msg", strings["loading..."]);
      
      let response;
      if (filterName === "top_rated") {
        response = await fetch(`${constants.API_BASE}/plugins?explore=random&page=${currentPage}&limit=${LIMIT}`);
      } else {
        response = await fetch(
          `${constants.API_BASE}/plugin?orderBy=${filterName}&page=${currentPage}&limit=${LIMIT}`,
        );
      }
      const fetchedPlugins = await response.json();
      
      if (fetchedPlugins.length < LIMIT) {
        hasMore = false;
      }
      
      const installed = await fsOperation(PLUGIN_DIR).lsDir();
      const disabledMap = settings.value.pluginsDisabled || {};
      
      installed.forEach(({ url }) => {
        const plugin = fetchedPlugins.find(({ id }) => id === Url.basename(url));
        if (plugin) {
          plugin.installed = true;
          plugin.enabled = disabledMap[plugin.id] !== true;
          plugin.onToggleEnabled = onToggleEnabled;
          plugin.localPlugin = getLocalRes(plugin.id, "plugin.json");
        }
      });
      
      // Add plugins to the all plugins array 
      plugins.all.push(...fetchedPlugins);
      
      const fragment = document.createDocumentFragment();
      fetchedPlugins.forEach((plugin) => {
        fragment.append(<Item {...plugin} updates={updates} />);
      });
      $list.all.append(fragment);
      
      currentPage++;
      $list.all.setAttribute("empty-msg", strings["no plugins found"]);
    } catch (error) {
      $list.all.setAttribute("empty-msg", strings["error"]);
      window.log("error", "Failed to filter plugins:");
      window.log("error", error);
    } finally {
      isLoading = false;
    }
  }

  async function getAllPlugins() {
    if (isLoading || !hasMore) return;

    try {
      isLoading = true;

      $list.all.setAttribute("empty-msg", strings["loading..."]);

      const response = await fetch(`${constants.API_BASE}/plugins?page=${currentPage}&limit=${LIMIT}`);
      const newPlugins = await response.json();

      if (newPlugins.length < LIMIT) {
        hasMore = false;
      }

      const installed = await fsOperation(PLUGIN_DIR).lsDir();
      const disabledMap = settings.value.pluginsDisabled || {};
      
      installed.forEach(({ url }) => {
        const plugin = newPlugins.find(({ id }) => id === Url.basename(url));
        if (plugin) {
          plugin.installed = true;
          plugin.enabled = disabledMap[plugin.id] !== true;
          plugin.onToggleEnabled = onToggleEnabled;
          plugin.localPlugin = getLocalRes(plugin.id, "plugin.json");
        }
      });

      // Add plugins to the all plugins array
      plugins.all.push(...newPlugins);
      
      const fragment = document.createDocumentFragment();
      newPlugins.forEach((plugin) => {
        fragment.append(<Item {...plugin} updates={updates} />);
      });
      $list.all.append(fragment);

      currentPage++;
      $list.all.setAttribute("empty-msg", strings["no plugins found"]);
    } catch (error) {
      window.log("error", error);
    } finally {
      isLoading = false;
    }
  }

  async function getInstalledPlugins(updates) {
    $list.installed.setAttribute("empty-msg", strings["loading..."]);
    plugins.installed = [];
    const disabledMap = settings.value.pluginsDisabled || {};
    const installed = await fsOperation(PLUGIN_DIR).lsDir();
    await Promise.all(
      installed.map(async (item) => {
        const id = Url.basename(item.url);
        if (!((updates && updates.includes(id)) || !updates)) return;
        const url = Url.join(item.url, "plugin.json");
        const plugin = await fsOperation(url).readFile("json");
        const iconUrl = getLocalRes(id, plugin.icon);
        plugin.icon = await helpers.toInternalUri(iconUrl);
        plugin.installed = true;
        plugin.enabled = disabledMap[id] !== true; // default to true
        plugin.onToggleEnabled = onToggleEnabled;
        plugins.installed.push(plugin);
        if ($list.installed.get(`[data-id=\"${id}\"]`)) return;
        $list.installed.append(<Item {...plugin} updates={updates} />);
      }),
    );
    $list.installed.setAttribute("empty-msg", strings["no plugins found"]);
  }

  async function getOwned() {
    $list.owned.setAttribute("empty-msg", strings["loading..."]);
    const purchases = await helpers.promisify(iap.getPurchases);
    const disabledMap = settings.value.pluginsDisabled || {};
    
    purchases.forEach(async ({ productIds }) => {
      const [sku] = productIds;
      const url = Url.join(constants.API_BASE, "plugin/owned", sku);
      const plugin = await fsOperation(url).readFile("json");
      const isInstalled = plugins.installed.find(({ id }) => id === plugin.id);
      plugin.installed = !!isInstalled;
      
      if (plugin.installed) {
        plugin.enabled = disabledMap[plugin.id] !== true;
        plugin.onToggleEnabled = onToggleEnabled;
      }
      
      plugins.owned.push(plugin);
      $list.owned.append(<Item {...plugin} updates={updates} />);
    });
    $list.owned.setAttribute("empty-msg", strings["no plugins found"]);
  }

  function onInstall(plugin) {
    if (updates) return;

    if (!plugin || !plugin.id) {
      console.error("Invalid plugin object passed to onInstall");
      return;
    }
    plugin.installed = true;

    const existingIndex = plugins.installed.findIndex(p => p.id === plugin.id);
    if (existingIndex === -1) {
      plugins.installed.push(plugin);
    } else {
      // Update existing plugin
      plugins.installed[existingIndex] = plugin;
    }

    const allPluginIndex = plugins.all.findIndex(p => p.id === plugin.id);
    if (allPluginIndex !== -1) {
      plugins.all[allPluginIndex] = plugin;
    }

    const existingItem = $list.installed.get(`[data-id="${plugin.id}"]`);
    if (!existingItem) {
      $list.installed.append(<Item {...plugin} updates={updates} />);
    }

  }

  function onUninstall(pluginId) {
    if (!updates) {
      plugins.installed = plugins.installed.filter(
        (plugin) => plugin.id !== pluginId,
      );

      const plugin = plugins.all.find((plugin) => plugin.id === pluginId);
      if (plugin) {
        plugin.installed = false;
        plugin.localPlugin = null;
      }
    }

    // Remove from DOM
    const existingItem = $list.installed.get(`[data-id="${pluginId}"]`);
    if (existingItem) {
      existingItem.remove();
    }
  }

  function getLocalRes(id, name) {
    return Url.join(PLUGIN_DIR, id, name);
  }

  async function addSource(sourceType, value = "https://") {
    let source;
    if (sourceType === "remote") {
      source = await prompt("Enter plugin source", value, "url");
    } else {
      source = (await FileBrowser("file", "Select plugin source")).url;
    }

    if (!source) return;

    try {
      await installPlugin(source);
      await getInstalledPlugins();
    } catch (error) {
      console.error(error);
      window.toast(helpers.errorMessage(error));
      addSource(sourceType, source);
    }
  }

  async function onToggleEnabled(id, enabled) {
    const disabledMap = settings.value.pluginsDisabled || {};

    if (enabled) {
      disabledMap[id] = true;
      settings.update({ pluginsDisabled: disabledMap }, false);
      window.acode.unmountPlugin(id);
      window.toast(strings["plugin_disabled"] || "Plugin Disabled");
    } else {
      delete disabledMap[id];
      settings.update({ pluginsDisabled: disabledMap }, false);
      await loadPlugin(id);
      window.toast(strings["plugin_enabled"] || "Plugin enabled");
    }

    // Update the plugin object's state in all plugin arrays
     const installedPlugin = plugins.installed.find(p => p.id === id);
     if (installedPlugin) {
       installedPlugin.enabled = !enabled;
     }
     
     const allPlugin = plugins.all.find(p => p.id === id);
     if (allPlugin) {
       allPlugin.enabled = !enabled;
     }
     
     const ownedPlugin = plugins.owned.find(p => p.id === id);
     if (ownedPlugin) {
       ownedPlugin.enabled = !enabled;
     }

     // Re-render the specific item in all tabs
     const $installedItem = $list.installed.get(`[data-id="${id}"]`);
     if ($installedItem && installedPlugin) {
       const $newItem = <Item {...installedPlugin} updates={updates} />;
       $installedItem.replaceWith($newItem);
     }
     
     const $allItem = $list.all.get(`[data-id="${id}"]`);
     if ($allItem && allPlugin) {
       const $newItem = <Item {...allPlugin} updates={updates} />;
       $allItem.replaceWith($newItem);
     }
     
     const $ownedItem = $list.owned.get(`[data-id="${id}"]`);
     if ($ownedItem && ownedPlugin) {
       const $newItem = <Item {...ownedPlugin} updates={updates} />;
       $ownedItem.replaceWith($newItem);
     }
  }
}
