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
	["src_sidebarApps_files_index_js"],
	{
		/***/ "./src/sidebarApps/files/index.js":
			/*!****************************************!*\
  !*** ./src/sidebarApps/files/index.js ***!
  \****************************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					'{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   fixHeight: function() { return /* binding */ fixHeight; }\n/* harmony export */ });\n/* harmony import */ var _style_scss__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./style.scss */ "./src/sidebarApps/files/style.scss");\n/* harmony import */ var components_sidebar__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! components/sidebar */ "./src/components/sidebar/index.js");\n/* harmony import */ var lib_settings__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! lib/settings */ "./src/lib/settings.js");\n\n\n\n\n/**@type {HTMLElement} */\nvar container;\n/* harmony default export */ __webpack_exports__["default"] = (["documents",\n// icon\n"files",\n// id\nstrings["files"],\n// title\ninitApp,\n// init function\nfalse,\n// prepend\nonSelected // onSelected function\n]);\n\n/**\n * Initialize files app\n * @param {HTMLElement} el\n */\nfunction initApp(el) {\n  container = el;\n  container.classList.add("files");\n  container.setAttribute("data-msg", strings["open folder"]);\n  container.style.overflowX = "auto";\n  container.addEventListener("click", clickHandler);\n  editorManager.on(["new-file", "int-open-file-list", "remove-file"], function (position) {\n    if (typeof position === "string" && position !== lib_settings__WEBPACK_IMPORTED_MODULE_2__["default"].OPEN_FILE_LIST_POS_SIDEBAR) return;\n    var fileList = container.get(":scope > div.file-list");\n    if (fileList) fixHeight(fileList);\n  });\n  editorManager.on("add-folder", fixHeight);\n  components_sidebar__WEBPACK_IMPORTED_MODULE_1__["default"].on("show", onSelected);\n}\n\n/**\n * On selected handler for files app\n * @param {HTMLElement} el\n */\nfunction onSelected(el) {\n  var $scrollableLists = container.getAll(":scope .scroll[data-scroll-top]");\n  $scrollableLists.forEach(function ($el) {\n    $el.scrollTop = $el.dataset.scrollTop;\n  });\n}\n\n/**\n * Click handler for files app\n * @param {MouseEvent} e\n * @returns\n */\nfunction clickHandler(e) {\n  if (!container.children.length) {\n    acode.exec("open-folder");\n    return;\n  }\n  var target = e.target;\n  if (target.matches(".files>.list>.tile")) {\n    fixHeight(target.parentElement);\n  }\n}\n\n/**\n * Update list height\n * @param {HTMLElement} target Target element\n */\nfunction fixHeight(target) {\n  var lists = Array.from(container.getAll(":scope > div"));\n  var ITEM_HEIGHT = 30;\n  var height = (lists.length - 1) * ITEM_HEIGHT;\n  var activeFileList;\n  if (lib_settings__WEBPACK_IMPORTED_MODULE_2__["default"].value.openFileListPos === lib_settings__WEBPACK_IMPORTED_MODULE_2__["default"].OPEN_FILE_LIST_POS_SIDEBAR) {\n    var firstList = lists[0];\n    if (firstList.classList.contains("file-list")) {\n      activeFileList = firstList;\n      if (firstList.unclasped) {\n        var heightOffset = height - ITEM_HEIGHT;\n        var totalHeight = ITEM_HEIGHT * activeFileList.$ul.children.length + ITEM_HEIGHT;\n        var maxHeight = lists.length === 1 || !lists.slice(1).find(function (list) {\n          return list.unclasped;\n        }) ? window.innerHeight : window.innerHeight / 2;\n        var minHeight = Math.min(totalHeight, maxHeight - heightOffset);\n        activeFileList.style.maxHeight = "".concat(minHeight, "px");\n        activeFileList.style.height = "".concat(minHeight, "px");\n        height += minHeight - ITEM_HEIGHT;\n      }\n    }\n  }\n  lists.forEach(function (list) {\n    if (list === activeFileList) return;\n    if (target === activeFileList) {\n      if (list.collapsed) return;\n      target = list;\n    }\n    if (list === target && target.unclasped) {\n      list.style.maxHeight = "calc(100% - ".concat(height, "px)");\n      list.style.height = "calc(100% - ".concat(height, "px)");\n      return;\n    }\n    if (list.collapsed) return;\n    list.collapse();\n    list.style.removeProperty("max-height");\n    list.style.removeProperty("height");\n    return;\n  });\n}\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/sidebarApps/files/index.js?\n}',
				);

				/***/
			},

		/***/ "./src/sidebarApps/files/style.scss":
			/*!******************************************!*\
  !*** ./src/sidebarApps/files/style.scss ***!
  \******************************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					"{__webpack_require__.r(__webpack_exports__);\n// extracted by mini-css-extract-plugin\n\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/sidebarApps/files/style.scss?\n}",
				);

				/***/
			},
	},
]);
