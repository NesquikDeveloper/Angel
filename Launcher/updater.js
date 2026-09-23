const axios = require("axios").default;
const Utils = require("./utils");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const { app, BrowserWindow, ipcMain } = require("electron");

const GITHUB_TOKEN_ENCRYPTED = "623f6ca1872d2203854ebd275cb3b7b5:8c0601008940c01095990f9d1b12a9fe:4ab53fcf41582a3bc853fa80e711c5bb9e9ed49d09a6df11a882d2c56db0f8bd8c01394f0785a4d6";

function decryptGithubToken() {
	try {
		const parts = GITHUB_TOKEN_ENCRYPTED.split(":");
		const key = crypto.scryptSync("angelclient_launcher_2024", "github_token_salt", 32);
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "hex"));
		decipher.setAuthTag(Buffer.from(parts[1], "hex"));
		let decrypted = decipher.update(parts[2], "hex", "utf8");
		decrypted += decipher.final("utf8");
		return decrypted;
	} catch(_) { return null; }
}

function githubHeaders() {
	const headers = { "Accept": "application/vnd.github+json" };
	const token = decryptGithubToken();
	if(token) {
		headers["Authorization"] = "Bearer " + token;
	}
	return headers;
}

// ── Repositórios GitHub ──
const LAUNCHER_REPO = "Bosta-Client/Angel-Launcher";
const CLIENT_REPO   = "Bosta-Client/client-1.8.9";

// Arquivo que guarda a versão do client JAR instalado
const clientVersionFile = () => path.join(Utils.dataDirectory, "client-version.json");

function getInstalledClientVersion() {
	try {
		if(fs.existsSync(clientVersionFile())) {
			return JSON.parse(fs.readFileSync(clientVersionFile(), "UTF-8")).version || null;
		}
	} catch(_) {}
	return null;
}

function saveInstalledClientVersion(version) {
	try {
		fs.writeFileSync(clientVersionFile(), JSON.stringify({ version }));
	} catch(_) {}
}

class Updater {

	// ── Atualização do Launcher ──
	static update() {
		return new Promise(async(resolve) => {
			try {
				let fileExtension;
				let destFile;
				let currentVersion = require("./package.json").version;
				let appimage = process.env.APPIMAGE;

				if(Utils.getOsName() == "windows") {
					fileExtension = ".exe";
					destFile = Utils.dataDirectory + "/Setup" + fileExtension;
					try {
						if(fs.existsSync(destFile)) {
							fs.rmSync(destFile);
						}
					}
					catch(error) {
						console.log(error);
						resolve(false);
						return;
					}
				}
				else if(Utils.getOsName() == "linux" && appimage) {
					fileExtension = ".AppImage";
					destFile = appimage + ".new";
				}

				if(require("electron-is-dev") || !fileExtension) {
					resolve(false);
					return;
				}

				console.log("[Updater] Verificando atualização do launcher...");

				let latestRelease;
				try {
					latestRelease = (await axios.get(
						`https://api.github.com/repos/${LAUNCHER_REPO}/releases/latest`,
						{ headers: githubHeaders(), timeout: 8000 }
					)).data;
				} catch(_) {
					console.log("[Updater] Sem conexão ou sem releases — pulando update do launcher.");
					resolve(false);
					return;
				}

				if(latestRelease.tag_name == currentVersion || latestRelease.name == currentVersion) {
					console.log("[Updater] Launcher já está na versão mais recente.");
					resolve(false);
					return;
				}

				let selectedAsset;
				for(let asset of latestRelease.assets) {
					if(asset.name.endsWith(fileExtension)) {
						selectedAsset = asset;
					}
				}

				if(!selectedAsset) {
					resolve(false);
					return;
				}

				console.log("[Updater] Instalando atualização do launcher:", latestRelease.tag_name || latestRelease.name);

				await app.whenReady();
				app.on("window-all-closed", (event) => event.preventDefault());

				let window = new BrowserWindow({
					width: 600,
					height: 210,
					icon: __dirname + "/assets/icon.png",
					webPreferences: {
						preload: path.join(__dirname, "/updater-dom.js")
					},
					title: "Atualizando Bosta Client...",
					show: false,
					backgroundColor: "#1e1e1e",
					resizable: false
				});

				window.loadFile("updating.html");
				window.setMenu(null);
				window.show();

				let wasClosed = false;

				window.on("close", () => {
					if(!wasClosed) {
						wasClosed = true;
						resolve(false);
					}
				});

				await Utils.download(selectedAsset.browser_download_url, destFile, -1, (progress) => {
					if(wasClosed) return false;
					window.webContents.send("progress", Math.round(progress) + "%");
					return true;
				});

				wasClosed = true;
				window.close();

				await sleep(1000);

				let command = destFile;

				if(Utils.getOsName() == "linux") {
					fs.renameSync(destFile, appimage);
					fs.chmodSync(appimage, 0o755);
					if(path.basename(appimage).includes(currentVersion)) {
						let newName = path.join(path.dirname(appimage),
								path.basename(appimage).replace(currentVersion, latestRelease.tag_name || latestRelease.name));
						fs.renameSync(appimage, newName);
						appimage = newName;
					}
					command = appimage;
				}

				if(Utils.getOsName() == "windows") {
					childProcess.execFileSync(command);
				}
				else {
					childProcess.spawn(command);
				}
				resolve(true);
				app.quit();
			}
			catch(error) {
				console.error("[Updater] Erro ao atualizar launcher:", error);
				resolve(false);
			}
		});
	}

	// ── Atualização do Client JAR ──
	// Chamado do processo renderer (launcher.js) via IPC
	static async updateClient(progressCallback) {
		try {
			console.log("[Updater] Verificando atualização do client...");

			let latestRelease;
			try {
				latestRelease = (await axios.get(
					`https://api.github.com/repos/${CLIENT_REPO}/releases/latest`,
					{ headers: githubHeaders(), timeout: 8000 }
				)).data;
			} catch(_) {
				console.log("[Updater] Sem conexão ou sem releases do client — usando JAR local.");
				return false;
			}

			const latestVersion = latestRelease.tag_name || latestRelease.name;
			const installedVersion = getInstalledClientVersion();

			if(installedVersion === latestVersion) {
				console.log("[Updater] Client já está na versão mais recente:", latestVersion);
				return false;
			}

			// Procura o asset game.jar na release
			let selectedAsset = latestRelease.assets.find(a =>
				a.name === "game.jar" || a.name.endsWith("-game.jar") || a.name.endsWith(".jar")
			);

			if(!selectedAsset) {
				console.log("[Updater] Nenhum JAR encontrado na release do client.");
				return false;
			}

			console.log("[Updater] Baixando client", latestVersion, "...");

			const destDir  = path.join(__dirname, "game/build/libs");
			const destFile = path.join(destDir, "game.jar");
			const tempFile = destFile + ".tmp";

			if(!fs.existsSync(destDir)) {
				fs.mkdirSync(destDir, { recursive: true });
			}

			// Baixa via API do GitHub com autenticação (repo privado)
			const writer = fs.createWriteStream(tempFile);
			const assetResponse = await axios.get(
				`https://api.github.com/repos/${CLIENT_REPO}/releases/assets/${selectedAsset.id}`,
				{
					headers: { ...githubHeaders(), "Accept": "application/octet-stream" },
					responseType: "stream",
					timeout: 120000,
					maxRedirects: 5
				}
			);

			const totalLength = parseInt(assetResponse.headers["content-length"] || "0");
			let downloaded = 0;

			assetResponse.data.on("data", (chunk) => {
				downloaded += chunk.length;
				if(totalLength && progressCallback) {
					progressCallback(Math.round(downloaded / totalLength * 100));
				}
			});

			assetResponse.data.pipe(writer);

			await new Promise((resolve, reject) => {
				writer.on("finish", resolve);
				writer.on("error", reject);
				assetResponse.data.on("error", reject);
			});

			// Substitui o JAR atual
			if(fs.existsSync(destFile)) fs.rmSync(destFile);
			fs.renameSync(tempFile, destFile);

			saveInstalledClientVersion(latestVersion);
			console.log("[Updater] Client atualizado para", latestVersion);
			return true;
		}
		catch(error) {
			console.error("[Updater] Erro ao atualizar client:", error);
			return false;
		}
	}

}

module.exports = Updater;
module.exports.decryptGithubToken = decryptGithubToken;
