"use strict";
/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(self["webpackChunkcom_foxdebug_acode"] = self["webpackChunkcom_foxdebug_acode"] || []).push([["customTheme"],{

/***/ "./src/pages/customTheme/customTheme.include.js":
/*!******************************************************!*\
  !*** ./src/pages/customTheme/customTheme.include.js ***!
  \******************************************************/
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": function() { return /* binding */ CustomThemeInclude; }\n/* harmony export */ });\n/* harmony import */ var _customTheme_scss__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./customTheme.scss */ \"./src/pages/customTheme/customTheme.scss\");\n/* harmony import */ var html_tag_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! html-tag-js */ \"./node_modules/html-tag-js/dist/tag.js\");\n/* harmony import */ var html_tag_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(html_tag_js__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var mustache__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! mustache */ \"./node_modules/mustache/mustache.mjs\");\n/* harmony import */ var _customTheme_hbs__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./customTheme.hbs */ \"./src/pages/customTheme/customTheme.hbs\");\n/* harmony import */ var _components_page__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../../components/page */ \"./src/components/page.js\");\n/* harmony import */ var _components_dialogboxes_color__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../../components/dialogboxes/color */ \"./src/components/dialogboxes/color.js\");\n/* harmony import */ var _utils_helpers__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../../utils/helpers */ \"./src/utils/helpers.js\");\n/* harmony import */ var _lib_constants__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ../../lib/constants */ \"./src/lib/constants.js\");\n/* harmony import */ var _components_dialogboxes_confirm__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ../../components/dialogboxes/confirm */ \"./src/components/dialogboxes/confirm.js\");\n/* harmony import */ var _components_dialogboxes_select__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! ../../components/dialogboxes/select */ \"./src/components/dialogboxes/select.js\");\n\n\n\n\n\n\n\n\n\n\nfunction CustomThemeInclude() {\n  var $page = (0,_components_page__WEBPACK_IMPORTED_MODULE_4__[\"default\"])(\"\".concat(strings['custom'], \" \").concat(strings['theme']).capitalize());\n  var unsaved = false;\n  $page.header.append(html_tag_js__WEBPACK_IMPORTED_MODULE_1___default()('span', {\n    className: 'icon historyrestore',\n    attr: {\n      action: 'reset-theme'\n    },\n    style: {\n      color: 'red'\n    }\n  }), html_tag_js__WEBPACK_IMPORTED_MODULE_1___default()('span', {\n    className: 'icon check',\n    attr: {\n      action: 'set-theme'\n    }\n  }));\n  render();\n  app.append($page);\n  _utils_helpers__WEBPACK_IMPORTED_MODULE_6__[\"default\"].showAd();\n  actionStack.push({\n    id: 'custom-theme',\n    action: $page.hide\n  });\n\n  $page.onhide = function () {\n    actionStack.remove('custom-theme');\n    _utils_helpers__WEBPACK_IMPORTED_MODULE_6__[\"default\"].hideAd();\n  };\n\n  $page.addEventListener('click', handleClick);\n  /**\n   * Handle click event\n   * @param {MouseEvent | TouchEvent} e\n   */\n\n  function handleClick(e) {\n    var $target = e.target;\n\n    if ($target instanceof HTMLElement) {\n      var action = $target.getAttribute('action');\n\n      if (action === 'set-theme') {\n        (0,_components_dialogboxes_select__WEBPACK_IMPORTED_MODULE_9__[\"default\"])(strings['theme type'], [['light', strings['light']], ['dark', strings['dark']]]).then(function (res) {\n          appSettings.update({\n            appTheme: 'custom',\n            customThemeMode: res\n          });\n          updateTheme();\n          var title = $page.header.text;\n\n          if (title.slice(-1) === '*') {\n            $page.header.text = title.slice(0, -1);\n          }\n        });\n        return;\n      }\n\n      if (action === 'set-color') {\n        var name = $target.getAttribute('name');\n        var defaultValue = $target.getAttribute('value');\n        (0,_components_dialogboxes_color__WEBPACK_IMPORTED_MODULE_5__[\"default\"])(defaultValue).then(function (color) {\n          appSettings.value.customTheme[name] = color;\n          appSettings.update();\n          var scrolltop = $page.get('#custom-theme').scrollTop;\n          render();\n          $page.get('#custom-theme').scrollTop = scrolltop;\n          if ($page.header.text.slice(-1) !== '*') $page.header.text += ' *';\n        });\n        return;\n      }\n\n      if (action === 'reset-theme') {\n        (0,_components_dialogboxes_confirm__WEBPACK_IMPORTED_MODULE_8__[\"default\"])(strings['info'].toUpperCase(), strings['reset warning']).then(function () {\n          appSettings.reset('customTheme');\n          render();\n          updateTheme();\n        });\n      }\n    }\n  }\n\n  function render() {\n    var customThemeColor = appSettings.value.customTheme;\n    var colors = Object.keys(customThemeColor).map(function (color) {\n      return {\n        color: color,\n        value: customThemeColor[color],\n        text: color.replace(/-/g, ' ').trim()\n      };\n    });\n    var html = mustache__WEBPACK_IMPORTED_MODULE_2__[\"default\"].render(_customTheme_hbs__WEBPACK_IMPORTED_MODULE_3__[\"default\"], {\n      colors: colors\n    });\n    var $content = $page.get('#custom-theme');\n    if ($content) $content.remove();\n    $page.body = html_tag_js__WEBPACK_IMPORTED_MODULE_1___default().parse(html);\n  }\n\n  function updateTheme() {\n    html_tag_js__WEBPACK_IMPORTED_MODULE_1___default().get('#custom-theme').textContent = _utils_helpers__WEBPACK_IMPORTED_MODULE_6__[\"default\"].jsonToCSS(_lib_constants__WEBPACK_IMPORTED_MODULE_7__[\"default\"].CUSTOM_THEME, appSettings.value.customTheme);\n    window.restoreTheme();\n  }\n}\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/customTheme/customTheme.include.js?");

/***/ }),

/***/ "./src/pages/customTheme/customTheme.scss":
/*!************************************************!*\
  !*** ./src/pages/customTheme/customTheme.scss ***!
  \************************************************/
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("__webpack_require__.r(__webpack_exports__);\n// extracted by mini-css-extract-plugin\n\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/customTheme/customTheme.scss?");

/***/ }),

/***/ "./src/pages/customTheme/customTheme.hbs":
/*!***********************************************!*\
  !*** ./src/pages/customTheme/customTheme.hbs ***!
  \***********************************************/
/***/ (function(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony default export */ __webpack_exports__[\"default\"] = (\"<div id='custom-theme' class='main'>\\n  <div id='color-list' class='list scroll'>\\n    {{#colors}}\\n      <div\\n        class='list-item'\\n        action='set-color'\\n        tabindex='0'\\n        value='{{value}}'\\n        name='{{color}}'\\n      >\\n        <style>\\n          .{{color}}::before{ background-color:{{value}}!important; }\\n        </style>\\n        <span class='icon color {{color}}'></span>\\n        <div class='container'>\\n          <span class='text'>{{text}}</span>\\n        </div>\\n      </div>\\n    {{/colors}}\\n  </div>\\n</div>\");\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/customTheme/customTheme.hbs?");

/***/ })

}]);