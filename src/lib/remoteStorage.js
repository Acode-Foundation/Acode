import Ftp from "fileSystem/ftp";
import Sftp from "fileSystem/sftp";
import loader from "dialogs/loader";
import multiPrompt from "dialogs/multiPrompt";
import URLParse from "url-parse";
import helpers from "utils/helpers";
import Url from "utils/Url";
import {
	createSftpProfileUrl,
	editSftpProfile,
	getSftpProfileId,
} from "./sftpProfiles";
import { interstitialAd } from "./startAd";

export default {
	/**
	 *
	 * @param  {...any} args [username, password, hostname, port, ftps, active, name]
	 */
	async addFtp(...args) {
		let stopConnection = false;
		const {
			username, //
			password,
			hostname,
			port,
			ftps,
			active,
			alias,
		} = await prompt(...args);
		const security = ftps ? "ftps" : "ftp";
		const mode = active ? "active" : "passive";
		const ftp = Ftp(hostname, username, password, port, security, mode);
		try {
			loader.create(strings["add ftp"], strings["connecting..."], {
				timeout: 10000,
				callback() {
					stopConnection = true;
				},
			});
			const [home] = await Promise.all([ftp.getWorkingDirectory(), loadAd()]);

			if (stopConnection) {
				stopConnection = false;
				return;
			}

			const url = Url.formate({
				protocol: "ftp:",
				username,
				password,
				hostname,
				port,
				path: "/",
				query: {
					mode,
					security,
				},
			});

			const res = {
				url,
				alias,
				name: alias,
				type: "ftp",
				home: null,
			};

			if (home !== "/") {
				res.home = home;
			}
			loader.destroy();
			await helpers.showInterstitialIfReady();
			return res;
		} catch (err) {
			if (stopConnection) {
				stopConnection = false;
				return;
			}

			loader.destroy();
			await helpers.error(err);
			return await this.addFtp(
				username,
				password,
				hostname,
				alias,
				port,
				security,
				mode,
			);
		}

		function prompt(username, password, hostname, alias, port, security, mode) {
			port = port || 21;
			security = security || "ftp";
			mode = mode || "passive";
			return multiPrompt(strings["add ftp"], [
				{
					id: "alias",
					placeholder: strings.name,
					type: "text",
					value: alias ? alias : "",
					required: true,
				},
				{
					id: "username",
					placeholder: `${strings.username} (${strings.optional})`,
					type: "text",
					value: username,
				},
				{
					id: "hostname",
					placeholder: strings.hostname,
					type: "text",
					required: true,
					value: hostname,
				},
				{
					id: "password",
					placeholder: `${strings.password} (${strings.optional})`,
					type: "password",
					value: password,
				},
				[
					`${strings["security type"]}: `,
					{
						id: "ftp",
						placeholder: "FTP",
						name: "type",
						type: "radio",
						value: security === "ftp" ? true : false,
					},
					{
						id: "ftps",
						placeholder: "FTPS",
						name: "type",
						type: "radio",
						value: security === "ftps" ? true : false,
					},
				],
				[
					`${strings["connection mode"]}: `,
					{
						id: "active",
						placeholder: "Active",
						name: "mode",
						type: "radio",
						value: mode === "active" ? true : false,
					},
					{
						id: "passive",
						placeholder: "Passive",
						name: "mode",
						type: "radio",
						value: mode === "passive" ? true : false,
					},
				],
				{
					id: "port",
					placeholder: `${strings.port} (${strings.optional})`,
					type: "number",
					value: port,
				},
			]);
		}
	},
	/** Open the native editor so SSH secrets never enter the WebView. */
	async addSftp(...args) {
		let stopConnection = false;
		const existingProfile = args[8] || null;
		const { alias } = await multiPrompt(strings["add sftp"], [
			{
				id: "alias",
				placeholder: strings.name,
				type: "text",
				value: args[6] || existingProfile?.name || "",
				required: true,
			},
		]);
		const profile = await editSftpProfile({
			profileId: existingProfile?.profileId,
			hostname: args[0] || "",
			username: args[1] || "",
			port: args[5] || 22,
			authType: args[7] === "keyFile" ? "key" : args[7] || "password",
		});
		const url = createSftpProfileUrl(profile.profileId);

		loader.create(strings["add sftp"], strings["connecting..."], {
			timeout: 10000,
			callback() {
				stopConnection = true;
			},
		});
		const connection = Sftp(null, 22, null, {
			profileID: profile.profileId,
		});

		try {
			const [home] = await Promise.all([connection.pwd(), loadAd()]);

			if (stopConnection) {
				stopConnection = false;
				return;
			}

			loader.destroy();
			await helpers.showInterstitialIfReady();
			return {
				alias,
				name: alias,
				url,
				type: "sftp",
				home,
			};
		} catch (err) {
			if (stopConnection) {
				stopConnection = false;
				return;
			}

			loader.destroy();
			if (!err?.reported) await helpers.error(err);
			return await this.addSftp(
				profile.hostname,
				profile.username,
				"",
				"",
				"",
				profile.port,
				alias,
				profile.authType,
				{ ...profile, url, home: existingProfile?.home },
			);
		}
	},
	async edit({ name, storageType, url, home }) {
		const profileId = getSftpProfileId(url);
		if (storageType === "sftp" && profileId) {
			return this.addSftp("", "", "", "", "", 22, name, "password", {
				profileId,
				url,
				home,
				name,
			});
		}

		let { username, password, hostname, port, query } = URLParse(url, true);

		if (username) {
			username = decodeURIComponent(username);
		}

		if (password) {
			password = decodeURIComponent(password);
		}

		if (storageType === "ftp") {
			let { security, mode } = query;
			if (security) {
				security = decodeURIComponent(security);
			}

			if (mode) {
				mode = decodeURIComponent(mode);
			}

			return this.addFtp(
				username,
				password,
				hostname,
				name,
				port,
				security,
				mode,
			);
		}

		if (storageType === "sftp") {
			let { passPhrase, keyFile } = query;
			if (passPhrase) {
				passPhrase = decodeURIComponent(passPhrase);
			}

			if (keyFile) {
				keyFile = decodeURIComponent(keyFile);
			}

			return this.addSftp(
				hostname,
				username,
				keyFile,
				password,
				passPhrase,
				port,
				name,
				password ? "password" : "key",
			);
		}

		return null;
	},
};

async function loadAd() {
	if (!helpers.canShowAds()) return;
	try {
		if (!(await interstitialAd?.isLoaded())) {
			toast(strings.loading);
			await interstitialAd?.load();
		}
	} catch (error) {
		console.warn("Failed to load interstitial ad.", error);
	}
}
