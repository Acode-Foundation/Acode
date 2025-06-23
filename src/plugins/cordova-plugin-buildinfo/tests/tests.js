exports.defineAutoTests = function () {
	describe('BuildInfo', function () {
		it ('should exist', function () {
			expect(window.BuildInfo).toBeDefined();
		});

		it ('should contain a Base URL specification that is a string', function () {
			expect(window.BuildInfo.baseUrl).toBeDefined();
			expect((String(window.BuildInfo.baseUrl)).length > 0).toBe(true);
		});

		it ('should contain a PackageName specification that is a string', function () {
			expect(window.BuildInfo.packageName).toBeDefined();
			expect((String(window.BuildInfo.packageName)).length > 0).toBe(true);
		});

		it ('should contain a Base PackageName specification that is a string', function () {
			expect(window.BuildInfo.basePackageName).toBeDefined();
			expect((String(window.BuildInfo.basePackageName)).length > 0).toBe(true);
		});

		it ('should contain a DisplayName specification that is a string', function () {
			expect(window.BuildInfo.displayName).toBeDefined();
			expect((String(window.BuildInfo.displayName)).length > 0).toBe(true);
		});

		it ('should contain a Name specification that is a string', function () {
			expect(window.BuildInfo.name).toBeDefined();
			expect((String(window.BuildInfo.name)).length > 0).toBe(true);
		});

		it ('should contain a Version specification that is a string', function () {
			expect(window.BuildInfo.version).toBeDefined();
			expect((String(window.BuildInfo.version)).length > 0).toBe(true);
		});

		it ('should contain a VersionCode specification that is a string or int', function () {
			expect(window.BuildInfo.versionCode).toBeDefined();
			if ('string' === typeof window.BuildInfo.versionCode || 'object' === typeof window.BuildInfo.versionCode) {
				expect((String(window.BuildInfo.versionCode)).length > 0).toBe(true);
			} else {
				expect(window.BuildInfo.versionCode > 0).toBe(true);
			}
		});

		it ('should contain a debug specification that is a boolean', function () {
			expect(window.BuildInfo.debug).toBeDefined();
			expect(typeof window.BuildInfo.debug).toBe('boolean');
		});

		it ('should contain a BuildType specification that is a string', function () {
			expect(window.BuildInfo.buildType).toBeDefined();
			expect(typeof window.BuildInfo.buildType).toBe('string');
		});

		it ('should contain a Flavor specification that is a string', function () {
			expect(window.BuildInfo.flavor).toBeDefined();
			expect(typeof window.BuildInfo.flavor).toBe('string');
		});

		it ('should contain a BuildDate specification that is a Date', function () {
			//expect(window.BuildInfo.buildDate).toBeDefined();
			//expect(window.BuildInfo.buildDate instanceof Date).toBe(true);
		});

		it ('should contain a InstallDate specification that is a Date', function () {
			expect(window.BuildInfo.installDate).toBeDefined();
			if (null !== window.BuildInfo.installDate) {
				expect(window.BuildInfo.installDate instanceof Date).toBe(true);
			}
		});
	});
};

exports.defineManualTests = function (contentEl, createActionButton) {
	var logMessage = function (message, color) {
		var log = document.getElementById('info');
		var logLine = document.createElement('div');

		if (color) {
			logLine.style.color = color;
		}

		logLine.innerHTML = message;
		log.appendChild(logLine);
	};

	var clearLog = function () {
		var log = document.getElementById('info');
		log.innerHTML = '';
	};

	var tests = '<h3>Press Dump BuildInfo button to get build information</h3>' +
		'<div id="dump_info"></div>' +
		'Expected result: Status box will get updated with build info.';

	contentEl.innerHTML = '<div id="info"></div>' + tests;

	createActionButton('Dump BuildInfo', function () {
		clearLog();
		logMessage(JSON.stringify(window.BuildInfo, null, "¥t"));
	}, 'dump_info');
};
