"use strict";
/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(self["webpackChunkcom_foxdebug_acode"] =
	self["webpackChunkcom_foxdebug_acode"] || []).push([
	["src_pages_quickTools_quickTools_js"],
	{
		/***/ "./src/pages/quickTools/quickTools.js":
			/*!********************************************!*\
  !*** ./src/pages/quickTools/quickTools.js ***!
  \********************************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					'{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   "default": function() { return /* binding */ QuickTools; }\n/* harmony export */ });\n/* harmony import */ var html_tag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! html-tag-js */ "./node_modules/html-tag-js/dist/tag.js");\n/* harmony import */ var html_tag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(html_tag_js__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _babel_runtime_helpers_asyncToGenerator__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @babel/runtime/helpers/asyncToGenerator */ "./node_modules/@babel/runtime/helpers/esm/asyncToGenerator.js");\n/* harmony import */ var _babel_runtime_helpers_defineProperty__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! @babel/runtime/helpers/defineProperty */ "./node_modules/@babel/runtime/helpers/esm/defineProperty.js");\n/* harmony import */ var _babel_runtime_regenerator__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! @babel/runtime/regenerator */ "./node_modules/@babel/runtime/regenerator/index.js");\n/* harmony import */ var _babel_runtime_regenerator__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_babel_runtime_regenerator__WEBPACK_IMPORTED_MODULE_3__);\n/* harmony import */ var _style_scss__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./style.scss */ "./src/pages/quickTools/style.scss");\n/* harmony import */ var components_page__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! components/page */ "./src/components/page.js");\n/* harmony import */ var components_quickTools_items__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! components/quickTools/items */ "./src/components/quickTools/items.js");\n/* harmony import */ var components_WebComponents_wcPage__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! components/WebComponents/wcPage */ "./src/components/WebComponents/wcPage.js");\n/* harmony import */ var dialogs_select__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! dialogs/select */ "./src/dialogs/select.js");\n/* harmony import */ var lib_actionStack__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! lib/actionStack */ "./src/lib/actionStack.js");\n/* harmony import */ var lib_settings__WEBPACK_IMPORTED_MODULE_10__ = __webpack_require__(/*! lib/settings */ "./src/lib/settings.js");\n/* harmony import */ var utils_helpers__WEBPACK_IMPORTED_MODULE_11__ = __webpack_require__(/*! utils/helpers */ "./src/utils/helpers.js");\n\n\n\n\nfunction ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }\nfunction _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { (0,_babel_runtime_helpers_defineProperty__WEBPACK_IMPORTED_MODULE_2__["default"])(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }\n\n\n\n\n\n\n\n\nfunction QuickTools() {\n  var $page = (0,components_page__WEBPACK_IMPORTED_MODULE_5__["default"])(strings["shortcut buttons"]);\n  render($page);\n  $page.addEventListener("click", clickHandler);\n  lib_actionStack__WEBPACK_IMPORTED_MODULE_9__["default"].push({\n    id: "quicktools-settings",\n    action: $page.hide\n  });\n  $page.onhide = function () {\n    lib_actionStack__WEBPACK_IMPORTED_MODULE_9__["default"].remove("quicktools-settings");\n    utils_helpers__WEBPACK_IMPORTED_MODULE_11__["default"].hideAd();\n  };\n  app.append($page);\n  utils_helpers__WEBPACK_IMPORTED_MODULE_11__["default"].showAd();\n}\n\n/**\n * Render the page\n * @param {WCPage} $page\n */\nfunction render($page) {\n  $page.content = html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()("div", "main", "quicktools-settings", ["\\n\\t\\t\\t", function () {\n    var totalRows = lib_settings__WEBPACK_IMPORTED_MODULE_10__["default"].QUICKTOOLS_ROWS * lib_settings__WEBPACK_IMPORTED_MODULE_10__["default"].QUICKTOOLS_GROUPS;\n    var limit = lib_settings__WEBPACK_IMPORTED_MODULE_10__["default"].QUICKTOOLS_GROUP_CAPACITY;\n    var rows = [];\n    for (var i = 0; i < totalRows; i++) {\n      var row = [];\n      for (var j = 0; j < limit; j++) {\n        var count = i * limit + j;\n        var index = lib_settings__WEBPACK_IMPORTED_MODULE_10__["default"].value.quicktoolsItems[count];\n        row.push(html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()(Item, _objectSpread({\n          index: count\n        }, components_quickTools_items__WEBPACK_IMPORTED_MODULE_6__["default"][index])));\n      }\n      rows.push(html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()("div", "row buttons-container section", [row]));\n    }\n    return rows;\n  }(), "\\n\\t\\t"]);\n}\n\n/**\n * Create a quicktools settings item\n * @param {object} param0\n * @param {string} param0.icon\n * @param {string} param0.letters\n * @param {number} param0.index\n * @returns\n */\nfunction Item(_ref) {\n  var icon = _ref.icon,\n    letters = _ref.letters,\n    index = _ref.index;\n  return html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()("span", "icon ".concat(icon), {\n    attr: {\n      "data-index": index,\n      "data-letters": letters\n    }\n  });\n}\n\n/**\n * Click handler for page\n * @param {MouseEvent} e\n */\nfunction clickHandler(_x) {\n  return _clickHandler.apply(this, arguments);\n}\nfunction _clickHandler() {\n  _clickHandler = (0,_babel_runtime_helpers_asyncToGenerator__WEBPACK_IMPORTED_MODULE_1__["default"])(/*#__PURE__*/_babel_runtime_regenerator__WEBPACK_IMPORTED_MODULE_3___default().mark(function _callee(e) {\n    var index, options, i;\n    return _babel_runtime_regenerator__WEBPACK_IMPORTED_MODULE_3___default().wrap(function (_context) {\n      while (1) switch (_context.prev = _context.next) {\n        case 0:\n          index = Number.parseInt(e.target.dataset.index, 10);\n          if (!isNaN(index)) {\n            _context.next = 1;\n            break;\n          }\n          return _context.abrupt("return");\n        case 1:\n          options = components_quickTools_items__WEBPACK_IMPORTED_MODULE_6__["default"].map(function (_ref2, i) {\n            var id = _ref2.id,\n              icon = _ref2.icon,\n              letters = _ref2.letters;\n            return [i, (0,components_quickTools_items__WEBPACK_IMPORTED_MODULE_6__.description)(id), icon, true, letters];\n          });\n          _context.next = 2;\n          return (0,dialogs_select__WEBPACK_IMPORTED_MODULE_8__["default"])(strings.select, options);\n        case 2:\n          i = _context.sent;\n          lib_settings__WEBPACK_IMPORTED_MODULE_10__["default"].value.quicktoolsItems[index] = i;\n          lib_settings__WEBPACK_IMPORTED_MODULE_10__["default"].update();\n          render(this);\n        case 3:\n        case "end":\n          return _context.stop();\n      }\n    }, _callee, this);\n  }));\n  return _clickHandler.apply(this, arguments);\n}\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/quickTools/quickTools.js?\n}',
				);

				/***/
			},

		/***/ "./src/pages/quickTools/style.scss":
			/*!*****************************************!*\
  !*** ./src/pages/quickTools/style.scss ***!
  \*****************************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					"{__webpack_require__.r(__webpack_exports__);\n// extracted by mini-css-extract-plugin\n\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/quickTools/style.scss?\n}",
				);

				/***/
			},
	},
]);
