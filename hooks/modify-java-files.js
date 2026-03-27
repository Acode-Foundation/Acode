const path = require('path');
const fs = require('fs');
const prettier = require('prettier');

main();

async function main() {
  const patchVersion = '2';
  const flagFile = path.resolve(__dirname, '../platforms/android/.flag_done');
  if (fs.existsSync(flagFile)) {
    const appliedVersion = fs.readFileSync(flagFile, 'utf8').trim();
    if (appliedVersion === patchVersion) {
      return;
    }
  }

  const base = path.resolve(__dirname, `../platforms/android/CordovaLib/src/org/apache/cordova`);
  const files = {
    'SystemWebView.java': `${base}/engine/SystemWebView.java`,
    'SystemWebViewEngine.java': `${base}/engine/SystemWebViewEngine.java`,
    'CordovaWebViewEngine.java': `${base}/CordovaWebViewEngine.java`,
    'CordovaWebView.java': `${base}/CordovaWebView.java`,
    'CordovaWebViewImpl.java': `${base}/CordovaWebViewImpl.java`,
  };

  const interfaceMethod = {
    name: 'setInputType',
    modifier: 'public',
    returnType: 'void',
    params: [
      {
        type: 'int',
        name: 'type',
      }
    ],
  };

  const nativeContextMenuInterfaceMethod = {
    name: 'setNativeContextMenuDisabled',
    modifier: 'public',
    returnType: 'void',
    params: [
      {
        type: 'boolean',
        name: 'disabled',
      }
    ],
  };

  const setInputTypeMethod = {
    name: 'setInputType',
    modifier: 'public',
    returnType: 'void',
    params: [
      {
        type: 'int',
        name: 'type',
      }
    ],
    body: ['webView.setInputType(type);'],
  };

  const setNativeContextMenuDisabledMethod = {
    name: 'setNativeContextMenuDisabled',
    modifier: 'public',
    returnType: 'void',
    params: [
      {
        type: 'boolean',
        name: 'disabled',
      }
    ],
    body: ['webView.setNativeContextMenuDisabled(disabled);'],
  };

  const contentToAdd = {
    'SystemWebView.java': {
      'import': [
        'android.graphics.Rect',
        'android.os.Build',
        'android.text.InputType',
        'android.view.ActionMode',
        'android.view.inputmethod.InputConnection',
        'android.view.inputmethod.EditorInfo',
        'android.view.Menu',
        'android.view.MenuItem',
        'android.view.View',
      ],
      'fields': [
        {
          type: 'int',
          name: 'type',
          modifier: 'private',
          value: '-1',
        },
        {
          type: 'int',
          name: 'NO_SUGGESTIONS',
          modifier: 'private',
          value: '0',
        },
        {
          type: 'int',
          name: 'NO_SUGGESTIONS_AGGRESSIVE',
          modifier: 'private',
          value: '1',
        },
        {
          type: 'boolean',
          name: 'nativeContextMenuDisabled',
          modifier: 'private',
          value: 'false',
        },
      ],
      methods: [
        {
          ...setInputTypeMethod,
          body: [`this.type = type;`]
        },
        {
          name: 'setNativeContextMenuDisabled',
          modifier: 'public',
          returnType: 'void',
          params: [
            {
              type: 'boolean',
              name: 'disabled',
            }
          ],
          body: [`this.nativeContextMenuDisabled = disabled;`],
        },
        {
          name: 'onCreateInputConnection',
          modifier: 'public',
          returnType: 'InputConnection',
          params: [
            {
              type: 'EditorInfo',
              name: 'outAttrs',
            }
          ],
          body: [
            `InputConnection ic = super.onCreateInputConnection(outAttrs);
            if (type == NO_SUGGESTIONS) {
              outAttrs.inputType |= InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
            } else if (type == NO_SUGGESTIONS_AGGRESSIVE) {
              outAttrs.inputType =
                InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS |
                InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD;
            } else {
              outAttrs.inputType |= InputType.TYPE_NULL;
            }

            return ic;`,
          ],
          notation: '@Override',
        },
        {
          name: 'startActionMode',
          modifier: 'public',
          returnType: 'ActionMode',
          params: [
            {
              type: 'ActionMode.Callback',
              name: 'callback',
            }
          ],
          body: [
            `return suppressActionMode(super.startActionMode(wrapActionModeCallback(callback)));`,
          ],
          notation: '@Override',
        },
        {
          name: 'startActionMode',
          modifier: 'public',
          returnType: 'ActionMode',
          params: [
            {
              type: 'ActionMode.Callback',
              name: 'callback',
            },
            {
              type: 'int',
              name: 'type',
            }
          ],
          body: [
            `return suppressActionMode(super.startActionMode(wrapActionModeCallback(callback), type));`,
          ],
          notation: '@Override',
        },
        {
          name: 'startActionModeForChild',
          modifier: 'public',
          returnType: 'ActionMode',
          params: [
            {
              type: 'View',
              name: 'originalView',
            },
            {
              type: 'ActionMode.Callback',
              name: 'callback',
            }
          ],
          body: [
            `return suppressActionMode(super.startActionModeForChild(originalView, wrapActionModeCallback(callback)));`,
          ],
          notation: '@Override',
        },
        {
          name: 'startActionModeForChild',
          modifier: 'public',
          returnType: 'ActionMode',
          params: [
            {
              type: 'View',
              name: 'originalView',
            },
            {
              type: 'ActionMode.Callback',
              name: 'callback',
            },
            {
              type: 'int',
              name: 'type',
            }
          ],
          body: [
            `return suppressActionMode(super.startActionModeForChild(originalView, wrapActionModeCallback(callback), type));`,
          ],
          notation: '@Override',
        },
        {
          name: 'wrapActionModeCallback',
          modifier: 'private',
          returnType: 'ActionMode.Callback',
          params: [
            {
              type: 'ActionMode.Callback',
              name: 'callback',
            }
          ],
          body: [
            `if (!nativeContextMenuDisabled || callback == null) {
              return callback;
            }
            return new ActionMode.Callback2() {
              @Override
              public boolean onCreateActionMode(ActionMode mode, Menu menu) {
                boolean created = callback.onCreateActionMode(mode, menu);
                if (created) {
                  suppressActionModeUi(mode, menu);
                }
                return created;
              }

              @Override
              public boolean onPrepareActionMode(ActionMode mode, Menu menu) {
                boolean prepared = callback.onPrepareActionMode(mode, menu);
                suppressActionModeUi(mode, menu);
                return prepared;
              }

              @Override
              public boolean onActionItemClicked(ActionMode mode, MenuItem item) {
                return callback.onActionItemClicked(mode, item);
              }

              @Override
              public void onDestroyActionMode(ActionMode mode) {
                callback.onDestroyActionMode(mode);
              }

              @Override
              public void onGetContentRect(ActionMode mode, View view, Rect outRect) {
                if (callback instanceof ActionMode.Callback2) {
                  ((ActionMode.Callback2) callback).onGetContentRect(mode, view, outRect);
                  return;
                }
                super.onGetContentRect(mode, view, outRect);
              }
            };`,
          ],
        },
        {
          name: 'suppressActionMode',
          modifier: 'private',
          returnType: 'ActionMode',
          params: [
            {
              type: 'ActionMode',
              name: 'mode',
            }
          ],
          body: [
            `if (mode == null || !nativeContextMenuDisabled) {
              return mode;
            }
            suppressActionModeUi(mode, mode.getMenu());
            return mode;`,
          ],
        },
        {
          name: 'suppressActionModeUi',
          modifier: 'private',
          returnType: 'void',
          params: [
            {
              type: 'ActionMode',
              name: 'mode',
            },
            {
              type: 'Menu',
              name: 'menu',
            }
          ],
          body: [
            `if (mode == null || !nativeContextMenuDisabled || menu == null) {
              return;
            }
            menu.clear();
            mode.setTitle(null);
            mode.setSubtitle(null);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
              post(() -> {
                if (!nativeContextMenuDisabled) {
                  return;
                }
                try {
                  mode.hide(0);
                } catch (Throwable ignored) {
                }
              });
            }`,
          ],
        },
      ]
    },
    'SystemWebViewEngine.java': {
      methods: [
        setInputTypeMethod,
        setNativeContextMenuDisabledMethod,
      ]
    },
    'CordovaWebViewEngine.java': {
      methods: [
        interfaceMethod,
        nativeContextMenuInterfaceMethod,
      ]
    },
    'CordovaWebView.java': {
      methods: [
        interfaceMethod,
        nativeContextMenuInterfaceMethod,
      ]
    },
    'CordovaWebViewImpl.java': {
      methods: [
        {
          ...setInputTypeMethod,
          body: [`engine.setInputType(type);`]
        },
        {
          ...setNativeContextMenuDisabledMethod,
          body: [`engine.setNativeContextMenuDisabled(disabled);`]
        }
      ]
    }
  };

  const fileContent = {};

  for (let file in files) {
    fileContent[file] = fs.readFileSync(files[file], 'utf8');
  }

  for (let file in contentToAdd) {
    const content = fileContent[file];
    const contentToAddTo = contentToAdd[file];
    const text = removeComments(content);
    let newContent = await format(text);
    if (contentToAddTo.import) {
      const imports = contentToAddTo.import.map(importStr => {
        return `import ${importStr};`;
      }).join('\n');

      newContent = newContent.replace(
        /^(\s*)(import.*;)/m,
        `$1${imports}\n$2`
      );
    }
    if (contentToAddTo.fields) {
      const fields = contentToAddTo.fields.map(field => {
        return getFieldString(field);
      }).join('\n');
      newContent = newContent.replace(
        /^(\s*)(\w+\s+\w+\s*;)/m,
        `$1${fields}\n$2`
      );
    }
    if (contentToAddTo.methods) {
      const methods = contentToAddTo.methods.map(method => {
        return getMethodString(method);
      }).join('\n');

      if (isInterface(file, content)) {
        const regex = getInterfaceDeclarationRegex(file);
        newContent = newContent.replace(
          regex,
          `$1${methods}\n$2`
        );
      } else {
        let regex = getConstructorRegex(file);
        if (regex.test(newContent)) {
          newContent = newContent.replace(
            regex,
            `$1${methods}\n$2`
          );
        } else {
          regex = getClassDeclarationRegex(file);
          newContent = newContent.replace(
            regex,
            `$1${methods}\n$2`
          );
        }
      }
    }

    newContent = await format(newContent);
    fs.writeFile(files[file], newContent, err => {
      if (err) {
        console.log(err);
        process.exit(1);
      }

      console.log(`${files[file]} updated`);
    });
  }

  fs.writeFile(flagFile, patchVersion, err => {
    if (err) {
      console.log(err);
      process.exit(1);
    }

    console.log(`${flagFile} updated`);
  });

  async function format(content) {
    return prettier.format(content, {
      plugins: ['prettier-plugin-java'],
      parser: 'java',
      tabWidth: 2,
      printWidth: Infinity
    });
  }

  function getMethodString(method) {
    const params = method.params.map(param => {
      return `${param.type} ${param.name}`;
    }).join(', ');

    let str = `${method.modifier} ${method.returnType} ${method.name}(${params})`;
    if (method.notation) {
      str = `\n${method.notation}\n${str}`;
    }
    if (method.body) {
      return str + `{${method.body.join('')}}`;
    }
    return str + ';';
  }

  function getFieldString(field) {
    return `${field.modifier} ${field.type} ${field.name}${field.value ? ` = ${field.value}` : ''};`;
  }

  function isInterface(filename, content) {
    return content.indexOf(`interface ${filename.split('.')[0]}`) > -1;
  }

  function getConstructorRegex(filename) {
    return new RegExp(`([^]*${filename.split('.')[0]}\\s*\\(.*\\)\\s*{[^}]*})([^]*)`, 'm');
  }

  function getInterfaceDeclarationRegex(filename) {
    return new RegExp(`([^]*interface\\s+${filename.split('.')[0]}[\\s\\w]*{)([^]*})`, 'm');
  }

  function getClassDeclarationRegex(filename) {
    return new RegExp(`([^]*class\\s+${filename.split('.')[0]}[\\s\\w]*{)([^]*})`, 'm');
  }

  function removeComments(content) {
    return content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '');
  }
}
