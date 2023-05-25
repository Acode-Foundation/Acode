import './style.scss';
import restoreTheme from 'lib/restoreTheme';
import inputhints from 'components/inputhints';

/**
 * @typedef {import('./inputhints').HintCallback} HintCallback
 * @typedef {import('./inputhints').HintModification} HintModification
 */

/**
 * Opens a pallete with input and hints
 * @param {(hints:HintModification)=>string[]} getList 
 * @param {()=>string} onselect 
 * @param {string} placeholder 
 * @param {function} onremove 
 */
export default function pallete(getList, onselect, placeholder, onremove) {
  const $input = <input onkeydown={onkeydown} type='search' placeholder={placeholder} onfocusout={remove} enterKeyHint='go' />;
  const $mask = <div className='mask' onclick={remove} />;
  const $pallete = <div id="pallete">{$input}</div>;

  inputhints($input, generateHints, (value) => {
    onselect(value);
    remove();
  });

  restoreTheme(true);
  app.append($pallete, $mask);
  $input.focus();

  actionStack.push({
    id: 'pallete',
    action: remove,
  });

  function onkeydown(e) {
    if (e.key === 'Escape') {
      remove();
    }
  }

  /**
   * Generates hint for inputhints
   * @param {HintCallback} setHints 
   * @param {HintModification} hintModification 
   */
  async function generateHints(setHints, hintModification) {
    setHints([{ text: strings['loading...'], value: '' }]);
    const list = getList(hintModification);
    let data = list instanceof Promise ? await list : list;
    setHints(data);
  }

  function remove() {
    actionStack.remove('pallete');
    restoreTheme();
    $pallete.remove();
    $mask.remove();
    if (typeof onremove === 'function') {
      onremove();
    } else if (editorManager.activeFile.focused) {
      editorManager.editor.focus();
    }
  }
}