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
	["src_sidebarApps_notification_index_js"],
	{
		/***/ "./src/sidebarApps/notification/index.js":
			/*!***********************************************!*\
  !*** ./src/sidebarApps/notification/index.js ***!
  \***********************************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					'{__webpack_require__.r(__webpack_exports__);\n/* harmony import */ var html_tag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! html-tag-js */ "./node_modules/html-tag-js/dist/tag.js");\n/* harmony import */ var html_tag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(html_tag_js__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var lib_notificationManager__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! lib/notificationManager */ "./src/lib/notificationManager.js");\n/* harmony import */ var _style_scss__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./style.scss */ "./src/sidebarApps/notification/style.scss");\n/* harmony import */ var components_sidebar__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! components/sidebar */ "./src/components/sidebar/index.js");\n\n\n\n\n\n/**@type {HTMLElement} */\nvar container;\n/** @type {HTMLElement} */\nvar $notificationContainer = null;\nvar notificationManager;\n/* harmony default export */ __webpack_exports__["default"] = (["notifications",\n// icon\n"notification",\n// id\nstrings["notifications"],\n// title\ninitApp,\n// init function\nfalse,\n// prepend\nonSelected // onSelected function\n]);\nvar $header = html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()("div", "header", ["\\n\\t\\t", html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()("div", "title", ["\\n\\t\\t\\t", strings["notifications"], "\\n\\t\\t\\t", html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()("span", "clear-all icon delete_outline", {\n  onclick: function onclick() {\n    return notificationManager.clearAll();\n  }\n}), "\\n\\t\\t"]), "\\n\\t"]);\n\n/**\n * Initialize files app\n * @param {HTMLElement} el\n */\nfunction initApp(el) {\n  container = el;\n  container.classList.add("notifications");\n  container.content = $header;\n  $notificationContainer = html_tag_js__WEBPACK_IMPORTED_MODULE_0___default()("div", "notifications-container scroll");\n  container.append($notificationContainer);\n  notificationManager = new lib_notificationManager__WEBPACK_IMPORTED_MODULE_1__["default"]();\n  components_sidebar__WEBPACK_IMPORTED_MODULE_3__["default"].on("show", onSelected);\n}\n\n/**\n * On selected handler for files app\n * @param {HTMLElement} el\n */\nfunction onSelected(el) {\n  var $scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");\n  $scrollableLists.forEach(function ($el) {\n    $el.scrollTop = $el.dataset.scrollTop;\n  });\n}\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/sidebarApps/notification/index.js?\n}',
				);

				/***/
			},

		/***/ "./src/sidebarApps/notification/style.scss":
			/*!*************************************************!*\
  !*** ./src/sidebarApps/notification/style.scss ***!
  \*************************************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					"{__webpack_require__.r(__webpack_exports__);\n// extracted by mini-css-extract-plugin\n\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/sidebarApps/notification/style.scss?\n}",
				);

				/***/
			},
	},
]);
