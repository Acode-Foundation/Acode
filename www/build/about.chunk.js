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
	["about"],
	{
		/***/ "./src/pages/about/about.hbs":
			/*!***********************************!*\
  !*** ./src/pages/about/about.hbs ***!
  \***********************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					'{__webpack_require__.r(__webpack_exports__);\n/* harmony default export */ __webpack_exports__["default"] = ("<main id=\'about-page\' class=\'main scroll\'>\\n    <div class=\\"logo\\">\\n        <img src=\'{{logo}}\' />\\n    </div>\\n\\n    <div class=\\"version-info\\">\\n        <h1 class=\\"version-title\\">Acode editor</h1>\\n        <div class=\\"version-number\\">Version {{version}} ({{versionCode}})</div>\\n    </div>\\n\\n    <div class=\\"info-section\\">\\n        {{#webview}}\\n        <a href=\\"https://play.google.com/store/apps/details?id={{packageName}}\\" class=\\"info-item\\">\\n            <div class=\\"info-item-icon\\">\\n                <span class=\\"icon googlechrome\\"></span>\\n            </div>\\n            <div class=\\"info-item-text\\">\\n                Webview {{versionName}}\\n                <div class=\\"info-item-subtext\\">{{packageName}}</div>\\n            </div>\\n        </a>\\n        {{/webview}}\\n        <a href=\\"https://acode.app\\" class=\\"info-item\\">\\n            <div class=\\"info-item-icon\\">\\n                <span class=\\"icon acode\\"></span>\\n            </div>\\n            <div class=\\"info-item-text\\">Official webpage</div>\\n        </a>\\n        <a href=\\"https://foxbiz.io\\" class=\\"info-item\\">\\n            <div class=\\"info-item-icon\\">\\n                <span class=\'icon public\'></span>\\n            </div>\\n            <div class=\\"info-item-text\\">foxbiz.io</div>\\n        </a>\\n    </div>\\n\\n    <div class=\\"social-links\\">\\n        <a href=\\"mailto:apps@foxdebug.com\\" class=\\"social-link\\">\\n            <div class=\\"social-icon\\">\\n                <span class=\\"icon gmail\\"></span>\\n            </div>\\n            Mail\\n        </a>\\n        <a href=\\"https://x.com/foxbiz_io\\" class=\\"social-link\\">\\n            <div class=\\"social-icon\\">\\n                <span class=\\"icon twitter\\"></span>\\n            </div>\\n            Twitter\\n        </a>\\n        <a href=\\"https://www.instagram.com/foxbiz.io/\\" class=\\"social-link\\">\\n            <div class=\\"social-icon\\">\\n                <span class=\\"icon instagram\\"></span>\\n            </div>\\n            Instagram\\n        </a>\\n        <a href=\\"https://github.com/Acode-Foundation/Acode\\" class=\\"social-link\\">\\n            <div class=\\"social-icon\\">\\n                <span class=\\"icon github\\"></span>\\n            </div>\\n            GitHub\\n        </a>\\n        <a href=\\"https://t.me/foxdebug_acode\\" class=\\"social-link\\">\\n            <div class=\\"social-icon\\">\\n                <span class=\\"icon telegram\\"></span>\\n            </div>\\n            Telegram\\n        </a>\\n        <a href=\\"https://discord.gg/nDqZsh7Rqz\\" class=\\"social-link\\">\\n            <div class=\\"social-icon\\">\\n                <span class=\\"icon public\\"></span>\\n            </div>\\n            Discord\\n        </a>\\n    </div>\\n</main>");\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/about/about.hbs?\n}',
				);

				/***/
			},

		/***/ "./src/pages/about/about.js":
			/*!**********************************!*\
  !*** ./src/pages/about/about.js ***!
  \**********************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					'{__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   "default": function() { return /* binding */ AboutInclude; }\n/* harmony export */ });\n/* harmony import */ var _babel_runtime_helpers_defineProperty__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! @babel/runtime/helpers/defineProperty */ "./node_modules/@babel/runtime/helpers/esm/defineProperty.js");\n/* harmony import */ var _about_scss__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./about.scss */ "./src/pages/about/about.scss");\n/* harmony import */ var components_page__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! components/page */ "./src/components/page.js");\n/* harmony import */ var lib_actionStack__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! lib/actionStack */ "./src/lib/actionStack.js");\n/* harmony import */ var mustache__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! mustache */ "./node_modules/mustache/mustache.mjs");\n/* harmony import */ var utils_helpers__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! utils/helpers */ "./src/utils/helpers.js");\n/* harmony import */ var res_logo_logo_png__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! res/logo/logo.png */ "./src/res/logo/logo.png");\n/* harmony import */ var _about_hbs__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./about.hbs */ "./src/pages/about/about.hbs");\n\nfunction ownKeys(e, r) { var t = Object.keys(e); if (Object.getOwnPropertySymbols) { var o = Object.getOwnPropertySymbols(e); r && (o = o.filter(function (r) { return Object.getOwnPropertyDescriptor(e, r).enumerable; })), t.push.apply(t, o); } return t; }\nfunction _objectSpread(e) { for (var r = 1; r < arguments.length; r++) { var t = null != arguments[r] ? arguments[r] : {}; r % 2 ? ownKeys(Object(t), !0).forEach(function (r) { (0,_babel_runtime_helpers_defineProperty__WEBPACK_IMPORTED_MODULE_0__["default"])(e, r, t[r]); }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function (r) { Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r)); }); } return e; }\n\n\n\n\n\n\n\nfunction AboutInclude() {\n  var $page = (0,components_page__WEBPACK_IMPORTED_MODULE_2__["default"])(strings.about.capitalize());\n  system.getWebviewInfo(function (res) {\n    return render(res);\n  }, function () {\n    return render();\n  });\n  lib_actionStack__WEBPACK_IMPORTED_MODULE_3__["default"].push({\n    id: "about",\n    action: $page.hide\n  });\n  $page.onhide = function () {\n    lib_actionStack__WEBPACK_IMPORTED_MODULE_3__["default"].remove("about");\n    utils_helpers__WEBPACK_IMPORTED_MODULE_5__["default"].hideAd();\n  };\n  app.append($page);\n  utils_helpers__WEBPACK_IMPORTED_MODULE_5__["default"].showAd();\n  function render(webview) {\n    var $content = utils_helpers__WEBPACK_IMPORTED_MODULE_5__["default"].parseHTML(mustache__WEBPACK_IMPORTED_MODULE_4__["default"].render(_about_hbs__WEBPACK_IMPORTED_MODULE_7__["default"], _objectSpread(_objectSpread({}, BuildInfo), {}, {\n      webview: webview,\n      logo: res_logo_logo_png__WEBPACK_IMPORTED_MODULE_6__\n    })));\n    $page.classList.add("about-us");\n    $page.body = $content;\n  }\n}\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/about/about.js?\n}',
				);

				/***/
			},

		/***/ "./src/pages/about/about.scss":
			/*!************************************!*\
  !*** ./src/pages/about/about.scss ***!
  \************************************/
			/***/ function (
				__unused_webpack_module,
				__webpack_exports__,
				__webpack_require__,
			) {
				eval(
					"{__webpack_require__.r(__webpack_exports__);\n// extracted by mini-css-extract-plugin\n\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/pages/about/about.scss?\n}",
				);

				/***/
			},

		/***/ "./src/res/logo/logo.png":
			/*!*******************************!*\
  !*** ./src/res/logo/logo.png ***!
  \*******************************/
			/***/ function (module, __unused_webpack_exports, __webpack_require__) {
				eval(
					'{module.exports = __webpack_require__.p + "logo.png";\n\n//# sourceURL=webpack://com.foxdebug.acode/./src/res/logo/logo.png?\n}',
				);

				/***/
			},
	},
]);
