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
	["src_pages_plugin_index_js"],
	{
		/***/ "./src/pages/plugin/index.js":
			/*!***********************************!*\
  !*** ./src/pages/plugin/index.js ***!
  \***********************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					'{__webpack_require__.r(__webpack_exports__);\nfunction plugin(_ref, onInstall, onUninstall) {\n  var id = _ref.id,\n    installed = _ref.installed,\n    install = _ref.install;\n  Promise.all(/*! import() | plugins */[__webpack_require__.e("vendors-node_modules_jszip_dist_jszip_min_js"), __webpack_require__.e("vendors-node_modules_moment_locale_af_js-node_modules_moment_locale_ar-dz_js-node_modules_mom-582c96"), __webpack_require__.e("src_lib_installPlugin_js"), __webpack_require__.e("plugins")]).then(__webpack_require__.bind(__webpack_require__, /*! ./plugin */ "./src/pages/plugin/plugin.js")).then(function (res) {\n    var Plugin = res["default"];\n    Plugin(id, installed, onInstall, onUninstall, install);\n  });\n}\n/* harmony default export */ __webpack_exports__["default"] = (plugin);\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/plugin/index.js?\n}',
				);

				/***/
			},
	},
]);
