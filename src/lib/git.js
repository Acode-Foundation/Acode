import fs from "./fileSystem/internalFs";
import dialogs from "../components/dialogs";
import helpers from "./utils/helpers";
import GitHub from './GitHubAPI/GitHub';
import path from "./utils/path";

//Creates new github object
function gitHub() {
  return new GitHub({
    username: localStorage.username ? helpers.credentials.decrypt(localStorage.username) : undefined,
    password: localStorage.password ? helpers.credentials.decrypt(localStorage.password) : undefined,
    token: localStorage.token ? helpers.credentials.decrypt(localStorage.token) : undefined
  });
}

/**
 *Initialize github object if directory named git exists 
 *then it checks for all git repositories record file
 **/
function init() {
  return new Promise((resolve, reject) => {
    const url = DATA_STORAGE + 'git/';
    let interval;

    window.resolveLocalFileSystemURL(url, success, error);

    function success() {
      initFile(gitRecordURL)
        .then(res => {
          window.gitRecord = GitRecord(res);
          return initFile(gistRecordURL);
        })
        .then(res => {
          window.gistRecord = GistRecord(res);
          resolve();
        })
        .catch(err => {
          if (err.code) {
            fileError(err.code);
          }
          reject(err);
        });
    }


    function initFile(file) {
      return new Promise((resolve, reject) => {

        fs.readFile(file) //initialized in main.js on device ready event
          .then(res => {
            const data = res.data;
            const decoder = new TextDecoder('utf-8');
            const val = JSON.parse(helpers.credentials.decrypt(decoder.decode(data)));
            resolve(val);
          })
          .catch(err => {
            if (err.code === 1) {
              const text = helpers.credentials.encrypt('{}');
              fs.writeFile(file, text, true, false)
                .then(() => {
                  resolve({});
                })
                .catch(err => {
                  reject(err);
                });
            }
          });
      });
    }

    function error(err) {
      if (err.code === 1) {
        fs.createDir(DATA_STORAGE, 'git')
          .then(() => {
            if (interval) clearInterval(interval);
            init();
          })
          .catch(err => {
            interval = setInterval(error, 1000);
          });
      } else {
        if (err.code) fileError(err.code);
        reject(err);
      }
    }
  });
}

function fileError(code) {
  dialogs.alert(strings.error, helpers.getErrorMessage(code));
}

function error(err) {
  if (err.response && err.response.status === 409) dialogs.alert(strings.error, strings["conflict error"]);
  else if (err) dialogs.alert(strings.error, err.toString());
  throw err;
}

/**
 * Creats a git repository record object
 * @param {string} sha 
 * @param {string} name 
 * @param {string} data 
 * @param {object} repo 
 * @param {string} path 
 * @returns {Repo}
 */
function Record(owner, sha, name, data, repo, path, branch) {
  if (!owner || !sha || !name || !repo) {
    throw new Error('Could not create Record because one or more paramert value is not valid');
  }
  const _record = {
    sha,
    name,
    data,
    path,
    repo,
    commitMessage: null,
    branch,
    owner
  };
  const repository = gitHub().getRepo(owner, repo);

  _record.commitMessage = `update ${_record.name}`;

  function update(data) {
    gitRecord.update(sha, _record, data);
  }

  function getPath(name) {
    return path ? path + '/' + name : name;
  }

  return {
    get sha() {
      return _record.sha;
    },
    get path() {
      return _record.path;
    },
    get branch() {
      return _record.branch;
    },
    get repo() {
      return _record.repo;
    },
    get owner() {
      return _record.owner;
    },
    set branch(str) {
      _record.branch = str;
    },
    get name() {
      return _record.name;
    },
    setName: str => {
      return new Promise((resolve, reject) => {
        const {
          branch,
          data
        } = _record;
        let _path = getPath(name);
        dialogs.loader.create(name, strings.loading + '...');
        repository.deleteFile(branch, _path)
          .then(res => {
            if (res.statusText === 'OK') {
              _path = getPath(str);
              return repository.writeFile(branch, _path, data, `Rename ${name} to ${str}`, {});
            }

            return Promise.reject(res);
          })
          .then(res => {
            if (res.statusText === 'Created') {
              _record.name = str;
              _record.commitMessage = `update ${str}`;
              update();
              resolve();
            } else {
              error(res);
              reject();
            }
          })
          .catch(err => {
            error(err);
            reject();
          })
          .finally(dialogs.loader.destroy);
      });
    },
    get data() {
      return _record.data;
    },
    get commitMessage() {
      return _record.commitMessage;
    },
    set commitMessage(str) {
      _record.commitMessage = str;
    },
    get repository() {
      return repository;
    },
    setData: (txt) => {
      return new Promise((resolve, reject) => {
        _record.data = txt;
        const {
          name,
          branch,
          commitMessage,
        } = _record;
        let _path = path ? path + '/' + name : name;
        dialogs.loader.create(name, strings.saving + '...');
        repository.writeFile(branch, _path, txt, commitMessage, {})
          .then(res => {
            if (res.statusText === 'OK') {
              update(txt);
              resolve();
            } else {
              error(res);
              reject();
            }
          })
          .catch(err => {
            error(err);
            reject();
          })
          .finally(dialogs.loader.destroy);
      });
    }
  };
}

/**
 * 
 * @param {Repo} obj
 * @returns {GitRecord} 
 */
function GitRecord(obj) {
  const gitRecord = obj;

  function get(sha) {
    return new Promise((resolve, reject) => {
      const record = gitRecord[sha];
      if (!record) resolve(null);
      const {
        name,
        repo,
        path,
        owner,
        branch
      } = record;
      fs.readFile(DATA_STORAGE + 'git/' + sha)
        .then(res => {
          const decoder = new TextDecoder('utf-8');
          const text = decoder.decode(res.data);
          let record;
          try {
            record = Record(owner, sha, name, text, repo, path, branch);
          } catch (error) {
            remove(sha);
          }
          resolve(record);
        })
        .catch(err => {
          if (err.code) fileError(err.code);
          reject(err);
        });
    });
  }

  function add(obj) {
    if (!obj.sha) throw new Error('sha must be a string');
    const {
      name,
      sha,
      repo,
      data,
      path,
      owner,
      branch
    } = obj;
    gitRecord[obj.sha] = {
      name,
      sha,
      repo,
      path,
      owner,
      branch
    };
    save();
    const record = Record(owner, sha, name, data, repo, path, branch);
    fs.writeFile(DATA_STORAGE + 'git/' + record.sha, data, true, false)
      .catch(err => {
        if (err.code) FileError(err.code);
        console.log(err);
      });
    return record;
  }

  function remove(sha) {
    delete gitRecord[sha];
    fs.deleteFile(DATA_STORAGE + 'git/' + sha);
    save();
  }

  function update(sha, record, data) {
    gitRecord[sha] = record;
    save(data ? strings['file saved'] : strings.success, data, record);
  }

  /**
   * 
   * @param {string} [echo] 
   * @param {string} [data] 
   * @param {Repo} [record] 
   */
  function save(echo = false, data = null, record = null) {
    let text = helpers.credentials.encrypt(JSON.stringify(gitRecord));
    let url = gitRecordURL;

    if (data) {
      if (!record) return;
      text = record.data;
      url = DATA_STORAGE + 'git/' + record.sha;
    }

    fs.writeFile(url, text, true, false)
      .then(() => {
        if (echo) plugins.toast.showShortBottom(echo);
      })
      .catch(err => {
        if (err.code) {
          fileError(err.code);
        }
        console.log(err);
      });
  }

  return {
    get,
    add,
    remove,
    update
  };
}

/**
 * Creats a gist object to manage gist file in editor
 * @param {string} id  
 * @param {GistFiles} [files]  
 * @param {boolean} [isNew]  
 * @param {boolean} [_public]  
 * @returns {Gist}
 */
function Gist(id, files, isNew, _public) {
  const gist = gitHub().getGist(id);
  const _this = {
    id,
    files,
    isNew,
    public: _public
  };

  /**
   * 
   * @param {string} name 
   * @returns {File}
   */
  function getFile(name) {
    for (let f of editorManager.files) {
      if (f.type === 'gist' && f.record.id === _this.id && f.name === name) return f;
    }
  }

  function setData(name, text, isDelete = false) {
    return new Promise((resolve, reject) => {
      _this.files[name].content = text;
      const update = {
        files: {}
      };
      update.files[name] = _this.files[name];

      dialogs.loader.create(name, strings.saving + '...');
      if (_this.isNew) {
        update.public = _this.public;
        gist.create(update)
          .then(res => {
            if (res.status === 201) {
              _this.id = res.data.id;
              gistRecord.update(_this);
              _this.isNew = false;
              editorManager.setSubText(getFile(name));
              resolve();
            }
          })
          .catch(err => {
            error(err);
            reject();
          })
          .finally(dialogs.loader.destroy);

        return;
      }

      gist.update(update)
        .then(res => {
          if (!res) return Promise.reject('No response');
          if (res.status === 200 || res.statusText === 'OK') {

            if (isDelete) {
              delete _this.files[name];
              editorManager.removeFile(getFile(name), true);
            }

            gistRecord.update(_this);
            resolve();
          } else {
            console.error(res);
            reject(res);
          }
        })
        .catch(err => {
          error(err);
          reject();
        })
        .finally(dialogs.loader.destroy);
    });
  }

  function setName(name, newName) {
    if (!newName) return new Error('newName cannot be empty');

    return new Promise((resolve, reject) => {

      if (_this.isNew) {
        changeName();
        return resolve();
      }

      const update = {
        files: {}
      };
      update.files[name] = {};
      update.files[name].filename = newName;
      dialogs.loader.create(name, strings.loading + '...');
      gist.update(update)
        .then(res => {
          if (res.status === 200 || res.statusText === 'OK') {

            resolve();
          } else {
            console.error(res);
            reject(res);
          }
        })
        .catch(err => {
          error(err);
          reject();
        })
        .finally(dialogs.loader.destroy);
    });

    function changeName() {
      const file = _this.files[name];
      delete _this.files[name];
      _this.files[newName] = file;
      gistRecord.update(_this);
    }
  }

  function addFile(name) {
    _this.files[name] = {
      filename: name
    };
    gistRecord.update(_this);
  }

  function removeFile(name) {
    return setData(name, '', true);
  }

  return {
    get id() {
      return _this.id;
    },
    get isNew() {
      return _this.isNew;
    },
    files: _this.files,
    setName,
    setData,
    addFile,
    removeFile
  };
}


/**
 * 
 * @param {object} obj 
 * @returns {GistRecord}
 */
function GistRecord(obj) {
  let gistRecord = obj;

  /**
   * 
   * @param {object} obj 
   * @param {boolean} isNew 
   * @returns {Gist}
   */
  function add(obj, isNew = false) {
    const id = obj.id;
    const _files = obj.files;
    const files = {};

    for (let filename in _files) {
      const file = _files[filename];
      files[filename] = {
        filename: file.filename,
        content: file.content
      };
    }
    gistRecord[obj.id] = {
      id,
      files
    };
    save();
    return Gist(id, files, isNew, !!obj.public);
  }

  /**
   * gets the gist with file content
   * @param {string} id 
   * @param {boolean} wasNew 
   * @returns {Gist}
   */
  function get(id, wasNew = false) {
    if (id in gistRecord) {
      const {
        files
      } = gistRecord[id];
      return Gist(id, files, wasNew);
    } else {
      return null;
    }
  }

  /**
   * 
   * @param {Gist} gist 
   */
  function update(gist) {
    add(gist);
  }

  /**
   * 
   * @param {Gist} gist 
   * @returns {Gist}
   */
  function remove(gist) {
    const _gist = gistRecord[gist.id];
    delete gistRecord[gist.id];

    return _gist;
  }

  function save(echo = null) {
    let text = helpers.credentials.encrypt(JSON.stringify(gistRecord));
    let url = gistRecordURL;
    fs.writeFile(url, text, true, false)
      .then(() => {
        if (echo) window.plugins.toast.showShortBottom(echo);
      })
      .catch(err => {
        console.error(err);
        if (err.code) fileError(err.code);
      });
  }

  function reset() {
    gistRecord = {};
    save();
  }

  return {
    add,
    get,
    update,
    remove,
    reset
  };
}

/**
 * 
 * @param {Repo} record 
 * @param {string} _path 
 */
function getGitFile(record, _path) {
  const {
    repo,
    owner,
    branch,
    path: p
  } = record;

  const repository = gitHub().getRepo(owner, repo);
  return new Promise((resolve, reject) => {
    repository.getSha(branch, path.resolve(p, _path).slice(1))
      .then(res => {
        resolve(atob(res.data.content));
      })
      .catch(err => {
        reject(err);
      });
  });
}

export default {
  init,
  GitHub: gitHub,
  getGitFile
};