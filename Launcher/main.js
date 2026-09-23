async function run() {
	if(require("electron-squirrel-startup")) return;

    const fs = require("fs");

	const Updater = require("./updater");
	const Utils = require("./utils");
	const Config = require("./config");

	Utils.init();
	Config.init(Utils.dataDirectory);
	Config.load();

	const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");

	ipcMain.on("disableUpdates", async() => {
		Config.data.autoUpdate = false;
		Config.save();
	});

	// ── Atualização do client JAR (chamado pelo renderer durante o launch) ──
	ipcMain.handle("update-client", async(_event) => {
		return await Updater.updateClient(null);
	});

	ipcMain.handle("update-client-progress", async(_event) => {
		// Versão com progresso — o renderer vai fazer polling via update-client
		return null;
	});

	if(Config.data.autoUpdate && await Updater.update()) {
		return;
	}

	const path = require("path");
	const msmc = require("msmc");
	const hastebin = require("hastebin");

	let window;
	let logWindow = null;
	let canQuit = false;

	function openLogWindow() {
		if (logWindow) {
			logWindow.focus();
			return;
		}

		logWindow = new BrowserWindow({
			width: 860,
			height: 500,
			minWidth: 600,
			minHeight: 300,
			title: "Bosta Client — Console",
			frame: false,
			backgroundColor: "#000000",
			icon: __dirname + "/assets/icon.png",
			webPreferences: {
				nodeIntegration: true,
				contextIsolation: false,
			},
		});

		logWindow.loadFile(path.join(__dirname, "log.html"));
		logWindow.setMenu(null);

		logWindow.on("closed", () => {
			logWindow = null;
		});
	}

	function createWindow() {
		let options = {
			width: 1060,
			height: 750,
			icon: __dirname + "/assets/icon.png",
			webPreferences: {
				preload: path.join(__dirname, "app.js")
			},
			title: "Bosta Client " + Utils.version,
			show: false,
			backgroundColor: "#1e1e1e",
			darkTheme: true
		};

		if(Utils.getOsName() == "osx") {
			options.titleBarStyle = "hidden";
		}

		window = new BrowserWindow(options);

		window.loadFile("app.html");
		window.setMenu(null);

		// window.webContents.openDevTools(); // Desabilitado - apenas para desenvolvimento

		window.on("close", (event) => {
			if(!canQuit) {
				event.preventDefault();
				window.webContents.send("close");
			}
		});

		window.once("ready-to-show", () => window.show());

		ipcMain.on("directory", async(event, title, id) => {
			let result = await dialog.showOpenDialog(window,
				{
					title: title,
					properties: ["openDirectory" ]
				}
			);

			let file = result.filePaths[0];

			if(!result.canceled && file) {
				event.sender.send("directory", file, id);
			}
		});

		ipcMain.on("jreError", async(event) => {
			dialog.showMessageBoxSync(window, {
				title: "Invalid Directory",
				message: "JRE must include bin folder."
			});
		});

		ipcMain.on("skinFile", async(event) => {
			let result = await dialog.showOpenDialog(window,
				{
					title: "Select Skin File",
					filters: [
						{
							name: "Minecraft Skins",
							extensions: ["png"]
						},
						{
							name: "All Files",
							extensions: ["*"]
						}
					]
				}
			);

			let file = result.filePaths[0];

			if(!result.canceled && file) {
				event.sender.send("skinFile", file);
			}
		});
	}

	ipcMain.on("msa", async(event) => {
		msmc.fastLaunch("electron", () => {})
				.then(async(result) => {
					await window.webContents.session.clearStorageData();
					event.sender.send("msa", JSON.stringify(result));
				});
	});

	ipcMain.on("crash", async(_event, report, file, optifine) => {
		let option = dialog.showMessageBoxSync(window, {
			title: "Game Crashed",
			message: `The game has crashed.
You may submit a report on GitHub, so it can be fixed.
This may include chat messages.
If you have private messages, try reproducing this issue again.`,
			type: "question",
			buttons: [
				"Do Nothing",
				"Open log file",
				"Submit a report"
			]
		});

		if(option == 1) {
			shell.openPath(file);
		}
		if(option != 2) {
			return;
		}

		let crashReportText = "Add any applicable crash reports, making sure not to include any personal information. It is most important that you do not include the session id.";
		if(report) {
			report = report.replace(/\[.*\] \[.*\]: \(Session ID is .{3,}\)/gm, "<censored>");

			hasteUrl = await hastebin.createPaste(report, {
				raw: true,
				contentType: "text/plain"
			});

			crashReportText = `<!-- Do not change this unless you need to. -->
[Game Log on Hastebin](${hasteUrl})`
		}

		let running = `Running Bosta Client v${Utils.version}`;

		if(optifine) {
			running += " with " + optifine;
		}

		running += " on " + Utils.getNiceOsName();
		running += ".";

		let url = new URL("https://github.com/TheKodeToad/Bosta-Client/issues/new/")
		url.searchParams.set("body", `## Description (please fill in)
A description of the problem that is occurring.
## Steps to Reproduce
1. What did you do...
2. ...to crash the game?
## Details
${running}
## Logs/Crash Report
${crashReportText}
`);
		url.searchParams.set("labels", "bug");
		shell.openExternal(url.toString());
	});

	ipcMain.on("devtools", () => window.webContents.openDevTools());

	// ── LOG DO RENDERER PARA O TERMINAL ──
	ipcMain.on("log", (_event, level, ...args) => {
		const prefix = `[Renderer]`;
		if(level === "error") {
			console.error(prefix, ...args);
		} else if(level === "warn") {
			console.warn(prefix, ...args);
		} else {
			console.log(prefix, ...args);
		}
	});

	// ── LOG WINDOW ──────────────────────────────────────
	ipcMain.on("game-started", () => {
		openLogWindow();
		if (logWindow) logWindow.webContents.on("did-finish-load", () => {
			logWindow.webContents.send("game-started");
		});
		
		// Close or minimize launcher based on config
		if(Config.data.closeOnLaunch && window) {
			window.minimize();
		}
	});

	ipcMain.on("minimize-log", () => {
		if (logWindow) logWindow.minimize();
	});

	ipcMain.on("game-log", (_event, line) => {
		if (logWindow) logWindow.webContents.send("log-line", line);
	});

	ipcMain.on("game-stopped", () => {
		if (logWindow) logWindow.webContents.send("game-stopped");
	});

	ipcMain.on("open-log-window", () => {
		openLogWindow();
	});
	// ────────────────────────────────────────────────────

	ipcMain.on("quit", (event, result) => {
		if(result) {
			canQuit = true;
			app.quit();
		}
		else {
			if(dialog.showMessageBoxSync(window, {
						title: "Quit Launcher?",
						message: "If you quit, the game will be closed.",
						type: "question",
						buttons: [
							"Don't quit",
							"Quit game and launcher"
						]
					}) == 1) {
				event.sender.send("quitGame");
			}
		}
	});

	app.whenReady().then(() => {
		createWindow();
	});
}

run();