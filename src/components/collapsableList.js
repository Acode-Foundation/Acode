import tag from 'html-tag-js';
import tile from './tile';

/**
 * @typedef {object} Collaspable
 * @extends HTMLElement
 * @property {HTMLElement} $title
 * @property {HTMLUListElement} $ul
 * @property {function(void):void} ontoggle
 * @property {function(void):void} collapse
 * @property {function(void):void} uncollapse
 * @property {boolean} collapsed
 * @property {boolean} uncollapsed
 */

/**
 * Create a collapsable list
 * @param {string} titleText Title of the list
 * @param {boolean} hidden If true, the list will be hidden
 * @param {"indicator"|"folder"} type Type of the list toggle indicator
 * @param {object} [options] Configuration options
 * @param {HTMLElement} [options.tail] Tail element of the title
 * @param {string} [options.type] Type of the list element
 * @param {boolean} [options.allCaps] If true, the title will be in all caps
 * @param {function(this:Collaspable):void} [options.ontoggle] Called when the list is toggled
 * @returns {Collaspable}
 */
export default function collapsableList(titleText, type = 'indicator', options = {}) {
  const $ul = tag('ul', {
    className: 'scroll',
  });
  const $collaspeIndicator = tag('span', {
    className: `icon ${type}`,
  });
  const $title = tile({
    lead: $collaspeIndicator,
    type: 'div',
    text: options.allCaps ? titleText.toUpperCase() : titleText,
    tail: options.tail,
  });
  const $mainWrapper = tag(options.type || 'div', {
    className: 'list collaspable hidden',
    children: [$title, $ul],
  });

  let collapse = () => {
    $mainWrapper.classList.add('hidden');
    if ($mainWrapper.ontoggle) $mainWrapper.ontoggle.call($mainWrapper);
  };

  let uncollapse = () => {
    $mainWrapper.classList.remove('hidden');
    if ($mainWrapper.ontoggle) $mainWrapper.ontoggle.call($mainWrapper);
  };

  $title.classList.add('light');
  $title.addEventListener('click', toggle);

  function toggle() {
    if ($title.collapsed) {
      uncollapse();
    } else {
      collapse();
    }
  }

  [$title, $mainWrapper].forEach(defineProperties);

  return $mainWrapper;

  function defineProperties($el) {
    Object.defineProperties($el, {
      $title: {
        get() {
          return $title;
        },
      },
      $ul: {
        get() {
          return $ul;
        },
      },
      ontoggle: {
        get() {
          return options.ontoggle;
        },
        set(fun) {
          if (typeof fun === 'function') options.ontoggle = fun;
        },
      },
      collapse: {
        get() {
          return collapse || (() => { });
        },
        set(fun) {
          if (typeof fun === 'function') collapse = fun;
        },
      },
      uncollapse: {
        get() {
          return uncollapse || (() => { });
        },
        set(fun) {
          if (typeof fun === 'function') uncollapse = fun;
        },
      },
      collapsed: {
        get() {
          return $mainWrapper.classList.contains('hidden');
        }
      },
      uncollapsed: {
        get() {
          return !this.collapsed;
        }
      },
    });
  }
}
