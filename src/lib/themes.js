import fsOperation from '../fileSystem';
import Url from '../utils/Url';
import fonts from './fonts';
import themes from './preLoadedThemes';
import restoreTheme from './restoreTheme';
import settings from './settings';
import ThemeBuilder from './themeBuilder';

/** @type {Map<string, ThemeBuilder>} */
const appThemes = new Map();
let themeApplied = false;

function init() {
  themes.forEach((theme) => add(theme));
}

/**
 * Returns a list of all themes
 * @returns {{name: string, type: string, version: string, primaryColor: string}}
 */
function list() {
  return [...appThemes.keys()].map((name) => {
    const { id, type, primaryColor, version } = appThemes.get(name);
    return {
      id,
      name,
      type,
      version,
      primaryColor,
    }
  });
}

/**
 * 
 * @param {string} name 
 * @returns {ThemeBuilder}
 */
function get(name) {
  return appThemes.get(name.toLowerCase());
}

/**
 * 
 * @param {ThemeBuilder} theme 
 * @returns 
 */
function add(theme) {
  if (!(theme instanceof ThemeBuilder)) return;
  appThemes.set(theme.id, theme);
  if (settings.value.appTheme === theme.id) {
    apply(theme.id);
  }
}

/**
 * Apply a theme
 * @param {string} id The name of the theme to apply
 * @param {boolean} init Whether or not this is the first time the theme is being applied
 */
async function apply(id, init) {
  themeApplied = true;
  const loaderFile = Url.join(ASSETS_DIRECTORY, 'res/tail-spin.svg');
  const svgName = '__tail-spin__.svg';
  const img = Url.join(DATA_STORAGE, svgName);
  const theme = get(id);
  const $style = document.head.get('style#app-theme') ?? <style id="app-theme"></style>;
  const update = {
    appTheme: id,
  };

  if (id === 'custom') {
    update.customTheme = theme.toJSON();
  }

  if (init && theme.preferredEditorTheme) {
    update.editorTheme = theme.preferredEditorTheme;
    editorManager.editor.setTheme(theme.preferredEditorTheme);
  }

  if (init && theme.preferredFont) {
    update.editorFont = theme.preferredFont;
    fonts.setFont(theme.preferredFont);
  }

  settings.update(update, false);
  localStorage.__primary_color = theme.primaryColor;
  document.body.setAttribute('theme-type', theme.type);
  $style.textContent = theme.css;
  document.head.append($style);
  restoreTheme();

  try {
    let fs = fsOperation(loaderFile);
    const svg = await fs.readFile('utf-8');

    fs = fsOperation(img);
    if (!(await fs.exists())) {
      await fsOperation(DATA_STORAGE).createFile(svgName);
    }
    await fs.writeFile(
      svg.replace(/#fff/g, theme.primaryColor),
    );
  } catch (error) {
    console.error(error);
  }
}

/**
 * Update a theme
 * @param {ThemeBuilder} theme 
 */
function update(theme) {
  if (!(theme instanceof ThemeBuilder)) return;
  const json = theme.toJSON();
  const oldTheme = get(theme.name);
  if (!oldTheme) return;
  Object.keys(json).forEach((key) => {
    oldTheme[key] = json[key];
  });
}

export default {
  get applied() {
    return themeApplied;
  },
  init,
  list,
  get,
  add,
  apply,
  update,
}
