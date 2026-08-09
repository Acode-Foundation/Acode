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
	getSftpProfileInfo,
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
	/** Persist credentials natively and retain only an opaque profile URL. */
	async addSftp({
		hostname = "",
		username = "",
		port = 22,
		alias: initialAlias = "",
		authType = "password",
		existingProfile = null,
	} = {}) {
		let stopConnection = false;
		if (existingProfile?.profileId) {
			try {
				const saved = await getSftpProfileInfo(existingProfile.profileId);
				hostname = saved.hostname;
				username = saved.username;
				port = saved.port;
				authType = saved.authType;
			} catch (error) {
				await helpers.error(error);
				return null;
			}
		}

		let values;
		try {
			values = await prompt({
				hostname,
				username,
				port,
				alias: initialAlias || existingProfile?.name || "",
				authType: authType === "keyFile" ? "key" : authType,
				hasSavedKey: existingProfile?.profileId && authType === "key",
			});
		} catch {
			return null;
		}

		const retryDetails = {
			hostname: values.hostname,
			username: values.username,
			port: values.port,
			alias: values.alias,
			authType: values.usePassword ? "password" : "key",
			existingProfile,
		};
		let profile;
		let saveError;
		try {
			profile = await editSftpProfile({
				profileId: existingProfile?.profileId,
				hostname: values.hostname,
				username: values.username,
				port: values.port,
				authType: values.usePassword ? "password" : "key",
				password: values.password,
				keyFile: values.keyFile,
				passPhrase: values.passPhrase,
			});
		} catch (error) {
			saveError = error;
		} finally {
			// Drop all WebView references as soon as the native store has consumed them.
			values.password = "";
			values.keyFile = "";
			values.passPhrase = "";
		}
		if (saveError) {
			values = null;
			await helpers.error(saveError);
			return this.addSftp(retryDetails);
		}
		const alias = values.alias;
		values = null;
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
			return await this.addSftp({
				hostname: profile.hostname,
				username: profile.username,
				port: profile.port,
				alias,
				authType: profile.authType,
				existingProfile: {
					...profile,
					url,
					home: existingProfile?.home,
				},
			});
		}

		function prompt({
			hostname,
			username,
			port,
			alias,
			authType,
			hasSavedKey,
		}) {
			const usePassword = authType !== "key";
			return multiPrompt(strings["add sftp"], [
				{
					id: "alias",
					placeholder: strings.name,
					type: "text",
					value: alias,
					required: true,
				},
				{
					id: "username",
					placeholder: strings.username,
					type: "text",
					value: username,
					required: true,
				},
				{
					id: "hostname",
					placeholder: strings.hostname,
					type: "text",
					value: hostname,
					required: true,
				},
				[
					"Authentication type: ",
					{
						id: "usePassword",
						placeholder: strings.password,
						name: "authType",
						type: "radio",
						value: usePassword,
						onchange() {
							if (!this.checked) return;
							this.prompt.$body.get("#password").hidden = false;
							this.prompt.$body.get("#keyFile").hidden = true;
							this.prompt.$body.get("#passPhrase").hidden = true;
						},
					},
					{
						id: "useKeyFile",
						placeholder: strings["key file"],
						name: "authType",
						type: "radio",
						value: !usePassword,
						onchange() {
							if (!this.checked) return;
							const password = this.prompt.$body.get("#password");
							password.hidden = true;
							password.value = "";
							this.prompt.$body.get("#keyFile").hidden = false;
							this.prompt.$body.get("#passPhrase").hidden = false;
						},
					},
				],
				{
					id: "password",
					placeholder: existingProfile?.profileId
						? `${strings.password} (leave blank to keep saved)`
						: strings.password,
					type: "password",
					hidden: !usePassword,
				},
				{
					id: "keyFile",
					placeholder: hasSavedKey
						? `${strings["select key file"]} (leave blank to keep saved)`
						: strings["select key file"],
					type: "text",
					readOnly: true,
					sensitive: true,
					hidden: usePassword,
					onclick() {
						sdcard.openDocumentFile((result) => {
							this.value = result.uri;
						});
					},
				},
				{
					id: "passPhrase",
					placeholder: `${strings.passphrase} (${strings.optional})`,
					type: "password",
					hidden: usePassword,
				},
				{
					id: "port",
					placeholder: strings.port,
					type: "number",
					value: port || 22,
					required: true,
				},
			]);
		}
	},
	async edit({ name, storageType, url, home }) {
		const profileId = getSftpProfileId(url);
		if (storageType === "sftp" && profileId) {
			return this.addSftp({
				alias: name,
				existingProfile: { profileId, url, home, name },
			});
		}
		if (storageType === "sftp") {
			const { username, hostname, port, query } = URLParse(url, true);
			return this.addSftp({
				hostname,
				username: username ? decodeURIComponent(username) : "",
				port: port || 22,
				alias: name,
				authType: query?.keyFile ? "key" : "password",
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
