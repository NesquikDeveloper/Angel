const axios = require("axios");
const msmc = require("msmc");
const fs = require("fs");
const keytar = require("keytar");
const Utils = require("./utils");
const KEYCHAIN_PREFIX = "keychain:";
const SERVICE = "angel_client";
let manager;

class AccountManager {

	static STEVE_HEAD = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAATElEQVR4nGP0Mtf4z4AHMOGTJEoB44HZ2f8ZGBgYHFKnMhyYnc2AzoYrwGvFg7tPMSRgYkwMDAwMCsrSDLvm7IVL7pqzl0FBWZo4KwBOChoq5wA2LAAAAABJRU5ErkJggg==";

	constructor(file, dataCallback) {
		this.file = file;
		if(fs.existsSync(file)) {
			let data = JSON.parse(fs.readFileSync(file, "UTF-8"));
			this.accounts = [];
			for(let account of data.accounts) {
				if(account.type != "msa" && account.type != "offline") {
					continue;
				}

				this.accounts.push(Account.from(account));
			}
			this.activeAccount = this.accounts[data.activeAccount];
			if(this.activeAccount) {
				this.fetchSkin(this.activeAccount);
			}
		}
		else {
			this.accounts = [];
		}
		this.save();
		this.dataCallback = dataCallback;
		this.refreshTask = {};
		manager = this;
	}

	save() {
		fs.writeFileSync(this.file, JSON.stringify({
			accounts: this.accounts,
			activeAccount: this.accounts.indexOf(this.activeAccount)
		}));
	}

	isInKeychain(prop) {
		return prop.startsWith(KEYCHAIN_PREFIX);
	}

	async storeInKeychain(account) {
		account.accessToken = await this.storeProp(account.accessToken, account.uuid + "_access_token");
		if(account._msmc) {
			account._msmc.refresh = await this.storeProp(account._msmc.refresh, account.uuid + "_refresh");
			account._msmc.mcToken = undefined; // ah yes, the number underfined
		}
	}

	async storeProp(prop, key) {
		if(this.isInKeychain(prop)) {
			return prop;
		}
		await keytar.setPassword(SERVICE, key, prop);
		let test = await keytar.getPassword(SERVICE, key);
		if(test != prop) {
			return prop;
		}
		return KEYCHAIN_PREFIX + key;
	}

	async retrieveProp(prop) {
		if(!this.isInKeychain(prop)) {
			return prop;
		}
		let key = prop.substring(KEYCHAIN_PREFIX.length);
		return keytar.getPassword(SERVICE, key);
	}

	async realToken(account) {
		return this.retrieveProp(account.accessToken);
	}

	async realRefresh(account) {
		if(!account._msmc) {
			return null;
		}

		return this.retrieveProp(account._msmc.refresh);
	}

	refreshAccount(account) {
		if(this.refreshTask[account]) {
			return this.refreshTask[account];
		}

		let task = new Promise(async(resolve, reject) => {
			try {
				let valid = await account.getService().validate(account);
				if(!valid) {
					let result = await account.getService().refresh(account);
					if(!result) {
						reject();
						return;
					}
					this.addAccount(result);
				}
				this.refreshTask[account] = null;
				resolve();
			}
			catch(error) {
				this.refreshTask[account] = null;
				reject(error);
			}
		});

		this.refreshTask[account] = task;
		return task;
	}

	getFullProfile(account) {
		return new Promise(async(resolve, reject) => {
			try {
				await this.refreshAccount(account);
				resolve((await axios.get("https://api.minecraftservices.com/minecraft/profile",
						{
							headers: {
								"Authorization": "Bearer " + account.accessToken
							}
						})).data);
			}
			catch(error) {
				reject(error);
			}
		});
	}

	async fetchSkin(account) {
		// Usa vzge.me para renders 3D bonitos
		if(account.type === "offline") {
			// Tenta buscar o UUID real do Mojang pelo username
			// Se existir, usa a skin do jogador original; senão, usa Steve
			try {
				const res = await axios.get(
					`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(account.username)}`,
					{ timeout: 4000 }
				);
				if(res.data && res.data.id) {
					// Jogador existe no Mojang — usa a skin real dele
					account.head = `https://vzge.me/face/512/${res.data.id}`;
				} else {
					account.head = `https://vzge.me/face/512/X-Steve`;
				}
			} catch(_) {
				// Username não existe no Mojang ou sem conexão — usa Steve
				account.head = `https://vzge.me/face/512/X-Steve`;
			}
		} else {
			// MSA: usa UUID sem dashes — mais confiável e sem rate limit do Mojang
			const uuidNoDashes = (account.uuid || "").replace(/-/g, "");
			account.head = uuidNoDashes
				? `https://vzge.me/face/512/${uuidNoDashes}`
				: `https://vzge.me/face/512/X-Steve`;
		}

		this.dataCallback(account);
		this.save();
	}

	switchAccount(account) {
		this.activeAccount = account;
		this.fetchSkin(account);
		this.save();
	}

	addAccount(account) {
		let sameUUIDIndex = -1;

		for(let i = 0; i < this.accounts.length; i++) {
			let item = this.accounts[i];
			// Só considera duplicata se UUID E tipo forem iguais
			// Isso evita que conta offline sobrescreva conta MSA com mesmo username
			if(item.uuid === account.uuid && item.type === account.type) {
				sameUUIDIndex = i;
			}
		}

		if(sameUUIDIndex === -1) {
			this.accounts.push(account);
		}
		else {
			this.accounts[sameUUIDIndex] = account;
		}

		this.switchAccount(account);
	}

	async removeAccount(account) {
		let index = this.accounts.indexOf(this.activeAccount);
		this.accounts = this.accounts.filter((item) => item != account);

		keytar.deletePassword(SERVICE, KEYCHAIN_PREFIX + account.uuid + "_access_token");
		keytar.deletePassword(SERVICE, KEYCHAIN_PREFIX + account.uuid + "_refresh");

		if(account == this.activeAccount) {
			this.activeAccount = this.accounts[index];

			if(!this.activeAccount) {
				this.activeAccount = this.accounts[index - 1];
			}

			this.save();
			return this.activeAccount != null;
		}

		this.save();
		return true;
	}

}

class AuthService {

	authenticate(_key) {
		throw new Error("Unimplemented");
	}

}

class MicrosoftAuthService extends AuthService {

	static instance = new MicrosoftAuthService();

	async authenticate(msmc) {
		let account = new Account("msa", msmc.name, msmc.id, msmc._msmc.mcToken, null, msmc._msmc.demo, msmc._msmc);
		msmc._msmc.mcToken = undefined;
		await manager.storeInKeychain(account);
		return account;
	}

	async toMsmc(account) {
		return {
			name: account.username,
			id: account.uuid,
			_msmc: { ...account._msmc, ...{ refresh: await manager.realRefresh(account), mcToken: await manager.realToken(account) } }
		}
	}

	validate(account) {
		return new Promise(async(resolve) => {
			resolve(msmc.validate(await this.toMsmc(account)));
		});
	}

	refresh(account) {
		return new Promise(async(resolve) => {
			let result = await msmc.refresh(await this.toMsmc(account), () => {}, {client_id: "00000000402b5328"});

			if(result.type != "Success") {
				resolve(null);
				return;
			}

			resolve(await this.authenticate(result.profile));
		});
	}

}

class OfflineAuthService extends AuthService {

	static instance = new OfflineAuthService();

	async authenticate(username) {
		// Gera UUID offline determinístico com prefixo "offline:" para nunca colidir com UUIDs MSA reais
		const crypto = require("crypto");
		const hash = crypto.createHash("md5").update("OfflinePlayer:" + username).digest("hex");
		const uuid = [
			hash.substring(0, 8),
			hash.substring(8, 12),
			"3" + hash.substring(13, 16),
			((parseInt(hash.substring(16, 18), 16) & 0x3f | 0x80).toString(16)) + hash.substring(18, 20),
			hash.substring(20, 32)
		].join("-");

		// Prefixo "offline-" garante que nunca vai colidir com UUID Mojang real
		const offlineUuid = "offline-" + uuid;

		let account = new Account("offline", username, offlineUuid, "0", null, false, null);
		return account;
	}

	validate(_account) {
		return Promise.resolve(true);
	}

	refresh(account) {
		return Promise.resolve(account);
	}

}

class Account {

	static from(object) {
		return Object.assign(new Account(null, null, null, null, null, false, null), object)
	}

	constructor(type, username, uuid, accessToken, clientToken, demo, _msmc) {
		this.type = type;
		this.username = username;
		this.uuid = uuid;
		this.accessToken = accessToken;
		this.clientToken = clientToken;
		this.demo = demo;
		this._msmc = _msmc;
		// Placeholder enquanto o fetchSkin não é chamado
		this.head = "headless.png";
	}

	getService() {
		if(this.type == "msa") {
			return MicrosoftAuthService.instance;
		}
		else if(this.type == "offline") {
			return OfflineAuthService.instance;
		}
		else {
			throw new Error("Unsupported account type " + this.type);
		}
	}

}

exports.MicrosoftAuthService = MicrosoftAuthService;
exports.OfflineAuthService = OfflineAuthService;
exports.Account = Account;
exports.AccountManager = AccountManager;
