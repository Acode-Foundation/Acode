//#region Imports
import './fileBrowser.scss';

import tag from 'html-tag-js';
import mustache from 'mustache';
import Page from '../../components/page';
import helpers from '../../lib/utils/helpers';
import contextMenu from '../../components/contextMenu';
import dialogs from '../../components/dialogs';
import constants from "../../lib/constants";
import filesSettings from '../settings/filesSettings';
import _template from './fileBrowser.hbs';
import _list from './list.hbs';
import _addMenu from './add-menu.hbs';
import externalFs from '../../lib/fileSystem/externalFs';
import fsOperation from '../../lib/fileSystem/fsOperation';
import SearchBar from '../../components/searchbar';
import projects from './projects';
import decryptAccounts from '../ftp-accounts/decryptAccounts';
import Url from '../../lib/utils/Url';
import util from './util';
//#endregion
/**
 * 
 * @param {"file"|"dir"} [type='file']
 * @param {string|function(string):boolean} option button text or function to check extension
 */
function FileBrowserInclude(type, option) {
  if (!type) type = 'file';
  const actionStack = window.actionStack;
  const prompt = dialogs.prompt;
  let customUuid = JSON.parse(localStorage.customUuid || '[]');

  return new Promise((_resolve, reject) => {
    //#region Declaration
    const $menuToggler = tag('i', {
      className: 'icon more_vert',
      attr: {
        action: 'toggle-menu'
      }
    });
    const $addMenuToggler = tag('i', {
      className: 'icon add',
      attr: {
        action: 'toggle-add-menu'
      }
    });
    const $search = tag('i', {
      className: 'icon search',
      attr: {
        action: 'search'
      }
    });
    const $page = Page('File Browser');
    const $content = tag.parse(mustache.render(_template, {
      type
    }));
    const $navigation = $content.querySelector('.navigation');
    const actionsToDispose = [];
    const menuOption = {
      top: '8px',
      right: '8px',
      toggle: $menuToggler,
      transformOrigin: 'top right'
    };
    const $fbMenu = contextMenu(
      `<li action="settings">${strings.settings}</li>
      <li action="reload">${strings.reload}</li>`,
      menuOption
    );
    const $addMenu = contextMenu({
      innerHTML: () => {
        if (currentDir.url === "/") {
          return `<li action="add-path">${strings['add path']}</li>`;
        } else {
          return mustache.render(_addMenu, strings);
        }
      },
      ...(menuOption.toggle = $addMenuToggler) && menuOption
    });
    const root = 'file:///storage/';
    let cachedDir = {};
    let currentDir = {
      url: "/",
      name: 'File browser'
    };
    let folderOption;
    //#endregion

    $content.addEventListener('click', handleClick);
    $content.addEventListener('contextmenu', handleContextMenu);
    $page.append($content);
    $page.querySelector('header').append($search, $addMenuToggler, $menuToggler);
    document.body.append($page);

    actionStack.push({
      id: 'filebrowser',
      action: function () {
        reject({
          error: 'user canceled',
          code: 0
        });
        $page.hide();
      }
    });

    $fbMenu.onclick = function (e) {
      $fbMenu.hide();
      const action = e.target.getAttribute('action');
      if (action === 'settings') {
        filesSettings(refresh);
      } else if (action === 'reload') {
        const {
          url,
          name
        } = currentDir;
        if (url in cachedDir) delete cachedDir[url];
        loadDir(url, name);
      }
    };

    $addMenu.onclick = function (e) {
      $addMenu.hide();
      const action = e.target.getAttribute('action');
      if (!action) return;

      if (action === 'create') {
        const value = e.target.getAttribute('value');
        create(value);
      } else if (action === "add-path") {
        dialogs.multiPrompt(strings["add path"], [{
            id: "name",
            placeholder: "Name",
            type: "text",
            required: true
          }, {
            id: "uri",
            placeholder: "path",
            type: "text",
            required: true,
            onclick: function () {
              SDcard.getStorageAccessPermission("", res => {
                this.value = res;
              }, err => {
                helpers.error(err);
              });
            }
          }])
          .then(values => {
            const {
              name,
              uri
            } = values;

            customUuid.push({
              name,
              uri,
              uuid: helpers.uuid()
            });
            localStorage.customUuid = JSON.stringify(customUuid);
            navigate.pop();
            renderStorages();
          });
      }
    };

    $search.onclick = function () {
      const $list = $content.get("#list");
      if ($list) SearchBar($list);
    };

    $page.onhide = function () {
      let id = '';
      while ((id = actionsToDispose.pop())) {
        actionStack.remove(id);
      }
      actionStack.remove('filebrowser');
      $content.removeEventListener('click', handleClick);
      $content.removeEventListener('contextmenu', handleContextMenu);
    };

    if (type === 'folder') {
      const openFolder = tag('button', {
        textContent: option || strings['select folder']
      });
      folderOption = tag('footer', {
        className: 'button-container',
        child: openFolder
      });

      $page.setAttribute('footer-height', 1);
      $page.append(folderOption);

      openFolder.onclick = () => {
        $page.hide();
        resolve(currentDir);
      };
    }

    renderStorages();

    function renderStorages() {
      // const list = [];
      // const version = parseInt(device.version);
      // if (version < 7) {
      //   renderList(getStorageList());
      // } else {
      //   let storages;

      //   externalFs.listStorages()
      //     .then(res => {
      //       storages = res;
      //       if (!Array.isArray(res))
      //         storages = [];

      //       return getPermission([...storages]);
      //     })
      //     .then(res => {
      //       storages.map(storage => {
      //         util.pushFolder(list, storage.name, res[storage.uuid]);
      //       });

      //       list.push(...getStorageList());
      //       renderList(list);
      //     })
      //     .catch(err => {
      //       console.error(err);
      //     });
      // }

      renderList(getStorageList());
    }

    function renderList(list) {
      delete localStorage.lastDir;
      if (type === 'folder')
        folderOption.classList.add('disabled');

      navigate("/", "/");
      currentDir.url = "/";
      currentDir.name = "File Browser";
      $page.settitle('File Browser');
      render(list);
    }

    // function getPermission(uuidDataAr) {
    //   const uuidUri = JSON.parse(localStorage.uuidUri || '{}');

    //   return new Promise((resolve, reject) => {
    //     (function get() {
    //       const uuidData = uuidDataAr.pop();
    //       if (uuidData) {
    //         const {
    //           uuid,
    //           name
    //         } = uuidData;
    //         if (uuid in uuidUri) {
    //           get(uuidDataAr);
    //         } else {
    //           externalFs.getStorageAccessPermission(uuid, name)
    //             .then(res => {
    //               uuidUri[uuid] = res;
    //               get(uuidDataAr, resolve);
    //             });
    //         }
    //       } else {
    //         localStorage.uuidUri = JSON.stringify(uuidUri);
    //         resolve(uuidUri);
    //       }
    //     })();
    //   });

    // }

    function resolve(data) {
      localStorage.setItem("lastDir", currentDir.url);
      _resolve(data);
    }

    /**
     * @returns {PathData[]}
     */
    function getStorageList() {
      const list = [];

      const path = cordova.file.externalRootDirectory;
      util.pushFolder(list, 'Internal storage', path);
      customUuid.map(storage => {
        util.pushFolder(list, storage.name, storage.uri, {
          closeable: {
            uuid: storage.uuid
          }
        });
      });

      let ftpaccounts;
      try {
        ftpaccounts = JSON.parse(localStorage.ftpaccounts);
        if (Array.isArray(ftpaccounts)) {
          ftpaccounts = decryptAccounts(ftpaccounts);
          ftpaccounts.map(account => {

            const {
              mode,
              security,
              name
            } = account;

            let url = Url.formate({
              protocol: "ftp:",
              ...account,
              query: {
                mode,
                security
              }
            });
            util.pushFolder(list, name, url);

          });
        }
      } catch (error) {}

      if (type === "file") {
        util.pushFolder(list, "Select document", null, {
          "open-doc": true
        });
      }

      cachedDir["/"] = {
        name,
        list
      };

      return list;
    }

    function loadDir(path = "/", name = 'File Browser') {

      let url = path;

      if (typeof path === 'object') {
        url = path.url;
        name = path.name;
      }

      if (url === "/") return renderStorages();

      if (url in cachedDir) {
        update();
        const item = cachedDir[url];
        render(item.list);
        const $list = tag.get('#list');
        $list.scrollTop = item.scroll;
        name = item.name;
      } else {
        const timeout = setTimeout(() => {
          dialogs.loader.create('', strings.loading + '...');
        }, 100);
        fsOperation(url)
          .then(fs => {
            return fs.lsDir();
          })
          .then(list => {
            update();
            list = helpers.sortDir(list,
              appSettings.value.fileBrowser
            );
            cachedDir[url] = {
              name,
              list
            };
            render(list);
          })
          .catch(err => {
            actionStack.remove(currentDir.url);
            helpers.error(err, url);
            console.error(err);
          })
          .finally(() => {
            clearTimeout(timeout);
            dialogs.loader.destroy();
          });
      }

      function update() {
        if (url === root) {
          $addMenuToggler.classList.add('disabled');
          if (type === 'folder') folderOption.classList.add('disabled');
        } else {
          $addMenuToggler.classList.remove('disabled');
          if (type === 'folder') folderOption.classList.remove('disabled');
        }

        localStorage.lastDir = url;
        currentDir.url = url;
        currentDir.name = name;
        const $list = tag.get('#list');
        if ($list) $list.scrollTop = 0;
        navigate(name, url);
        $page.settitle(name);
      }
    }

    /**
     * 
     * @param {MouseEvent} e 
     * @param {"contextmenu"} [contextMenu] 
     */
    function handleClick(e, contextMenu) {
      /**
       * @type {HTMLElement}
       */
      const $el = e.target;
      let action = $el.getAttribute('action');
      if (!action) return;

      const url = $el.getAttribute('url');
      const name = $el.getAttribute('name');
      const opendoc = $el.getAttribute('open-doc');

      if (opendoc) action = "open-doc";

      switch (action) {
        case 'navigation':
        case 'folder':
          folder();
          break;
        case 'file':
          file();
          break;
        case "open-doc":
          openDoc();
          break;
        case "remove-path":
          removePath();
          break;
      }

      function removePath() {
        const uuid = $el.getAttribute("uuid");
        if (Array.isArray(customUuid)) {
          customUuid = customUuid.filter(storage => storage.uuid !== uuid);
          localStorage.customUuid = JSON.stringify(customUuid);
          navigate.pop();
          renderStorages();
        }
      }

      function folder() {
        if (contextMenu !== 'contextmenu') {
          const currentUrl = currentDir.url;
          cachedDir[currentUrl].scroll = tag.get('#list').scrollTop;
          actionsToDispose.push(currentUrl);
          actionStack.push({
            id: currentUrl,
            action: function () {
              navigate.pop();
            }
          });
          loadDir(url, name);
        } else {
          cmhandle();
        }
      }

      function file() {
        if (contextMenu !== "contextmenu") {
          if (typeof option === 'function' && option(name)) {
            $page.hide();
            resolve({
              url
            });
          }
        } else {
          cmhandle();
        }
      }

      function cmhandle() {
        navigator.vibrate(constants.VIBRATION_TIME);
        dialogs.select('', [
            ['delete', strings.delete, 'delete'],
            ['rename', strings.rename, 'edit']
          ])
          .then(res => {

            switch (res) {
              case 'delete':
                dialogs.confirm(strings["delete {name}"].replace('{name}', name))
                  .then(remove);
                break;
              case 'rename':
                dialogs.prompt(strings.rename, name, "text", {
                  match: constants.FILE_NAME_REGEX
                }).then(newname => {
                  rename(newname);
                });
                break;
            }

          });
      }

      function rename(newname) {
        fsOperation(url)
          .then(fs => {
            return fs.renameTo(newname);
          })
          .then(() => {
            updateAddedFolder(url);
            window.plugins.toast.showShortBottom(strings.success);
            loadDir(currentDir);
          })
          .catch(err => {
            helpers.error(err);
            console.error(err);
          });
      }

      function remove() {
        fsOperation(url)
          .then(fs => {
            if (action === "file") return fs.deleteFile();
            if (action === "folder") return fs.deleteDir();
          })
          .then(() => {
            updateAddedFolder(url);
            window.plugins.toast.showShortBottom(strings.success);
            loadDir(currentDir);
          })
          .catch(err => {
            console.error(err);
            helpers.error(err);
          });
      }

      function openDoc() {
        SDcard.openDocumentFile(res => {
          res.isContentUri = true;
          res.url = res.uri;
          resolve(res);
          $page.hide();

        }, err => {
          helpers.error(err);
          console.error(err);
        });
      }
    }

    function handleContextMenu(e) {
      handleClick(e, 'contextmenu');
    }

    function refresh() {
      cachedDir = {};
      loadDir(currentDir.url, currentDir.name);
    }

    function render(list) {
      const $list = tag.parse(mustache.render(_list, {
        msg: strings['empty folder message'],
        list
      }));

      const $oldList = $content.querySelector('#list');
      if ($oldList) $oldList.remove();
      $content.append($list);
      $list.focus();
    }

    function navigate(name, url) {
      let $nav = $navigation.querySelector(`[url="${url}"]`);
      const $old = $navigation.querySelector('.active');
      if ($old) $old.classList.remove('active');

      //If navigate to previous directories, clear the rest navigation
      if ($nav) {
        let $topNav;
        while (($topNav = $navigation.lastChild) !== $nav) {
          const url = $topNav.getAttribute('url');
          actionStack.remove(url);
          actionsToDispose.pop();
          $topNav.remove();
        }

        actionStack.remove(url);
        actionsToDispose.pop();
        return $nav.classList.add('active');
      }


      $nav = tag('span', {
        className: 'nav active',
        attr: {
          action: 'navigation',
          url,
          text: name,
          name
        },
        tabIndex: -1
      });

      $navigation.append($nav);
      $navigation.scrollLeft = $navigation.scrollWidth;
    }

    navigate.pop = function () {
      const $nav = $navigation.lastChild.previousElementSibling;
      if ($nav) {
        const url = $nav.getAttribute('url');
        navigate(undefined, url);
        loadDir(url);
      }
    };

    function updateAddedFolder(url) {
      if (cachedDir[url]) delete cachedDir[url];
      if (cachedDir[currentDir.url]) delete cachedDir[currentDir.url];
      for (let folder of addedFolder) {
        if (folder.url === url) {
          folder.remove();
        } else if (new RegExp(url).test(currentDir.url)) {
          folder.reload();
        }
      }
    }

    /**
     * 
     * @param {"file"|"folder"|"project"} arg 
     */
    function create(arg) {
      const {
        url,
        name
      } = currentDir;


      if (arg === "file" || arg === "folder") {
        let title = strings['enter folder name'];
        let val = strings['new folder'];
        if (arg === "file") {
          title = strings["enter file name"];
          val = 'untitled.txt';
        }
        prompt(title, val, 'filename', {
          match: constants.FILE_NAME_REGEX,
          required: true
        }).then(entryName => {
          if (!entryName) return;
          entryName = helpers.removeLineBreaks(entryName);

          fsOperation(url)
            .then(fs => {
              if (arg === "folder") return fs.createDirectory(entryName);
              if (arg === "file") return fs.createFile(entryName);
            })
            .then((res) => {
              updateAddedFolder(url);
              window.plugins.toast.showLongBottom(strings.success);
              loadDir(url, name);
            }).catch(e => {
              helpers.error(e);
              console.error(e);
            });
        });
      } else if (arg === "project") {

        const options = [];
        const alreadyCreated = [];
        let project = '';
        let cturl = '';
        let newUrl = null;
        let projectName = '';
        let framework = '';

        Object.keys(projects).map(projectname => {
          options.push([projectname, projectname, "icon " + projectname]);
        });

        dialogs.select(strings["new project"], options)
          .then(res => {
            framework = res;
            dialogs.loader.create(res, strings.loading + '...');
            return projects[res]();
          })
          .then(res => {
            dialogs.loader.destroy();
            project = res.default;
            return dialogs.prompt(strings["project name"], framework, "text", {
              required: true,
              match: constants.FILE_NAME_REGEX
            });
          })
          .then(name => {
            projectName = name;
            return fsOperation(url);
          })
          .then(fs => {
            dialogs.loader.create(projectName, strings.loading + '...');
            return fs.createDirectory(projectName);
          })
          .then(res => {
            newUrl = Url.join(url, projectName, "/");
            const files = Object.keys(project);

            return new Promise((resolve, reject) => {
              createProject(resolve, reject);
            });

            function createProject(resolve, reject) {
              if (!files.length) {
                updateAddedFolder(url);
                window.plugins.toast.showLongBottom(strings.success);
                loadDir(url, name);
                resolve();
              }
              cturl = '';
              const file = files.pop();
              createFile(file)
                .then(() => {
                  createProject(resolve, reject);
                })
                .catch(reject);
            }

            function createFile(fileurl) {
              const paths = fileurl.split("/");
              const filename = paths.pop();

              return new Promise((resolve, reject) => {
                createDir();

                function createDir() {
                  const lclUrl = Url.join(newUrl, cturl);

                  if (paths.length === 0) {
                    return fsOperation(lclUrl)
                      .then(fs => {
                        const data = project[fileurl].replace(/<%name%>/g, projectName);
                        return fs.createFile(filename, data);
                      })
                      .then(resolve)
                      .catch(reject);
                  }

                  const name = paths.splice(0, 1)[0];
                  const toCreate = Url.join(lclUrl, name);

                  fsOperation(lclUrl)
                    .then(fs => {
                      if (alreadyCreated.includes(toCreate)) return Promise.resolve();
                      return fs.createDirectory(name);
                    })
                    .then(res => {
                      if (!alreadyCreated.includes(toCreate))
                        alreadyCreated.push(toCreate);
                      cturl += name + '/';
                      return createDir(paths);
                    })
                    .catch(reject);
                }
              });
            }

          })
          .catch(err => {
            helpers.error(err);
            console.error(err);
          })
          .finally(() => {
            dialogs.loader.destroy();
          });

      }

    }
  });
}

export default FileBrowserInclude;