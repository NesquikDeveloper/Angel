// coins.js — Sistema de moedas Bosta Client
// API: https://api.angelclient.xyz
// Chave: angelclient-2026

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

const API_BASE = "https://api.angelclient.xyz";
const API_KEY  = "angelclient-2026";

// Firebase (mesmo DB do friends.js)
const FB_URL = "https://angel-client-cosmetics-default-rtdb.firebaseio.com";

// Arquivo onde o Discord ID vinculado é salvo
let discordIdFile = null;
let _currentUuid = null;

function init(base) {
	discordIdFile = path.join(base, "discord_link.json");
}

function setCurrentUuid(uuid) {
	_currentUuid = uuid;
}

function getSavedDiscordId() {
	if (!discordIdFile || !fs.existsSync(discordIdFile)) return null;
	try {
		const data = JSON.parse(fs.readFileSync(discordIdFile, "UTF-8"));
		return data.discordId || null;
	} catch (_) {
		return null;
	}
}

function getSavedDiscordUser() {
	if (!discordIdFile || !fs.existsSync(discordIdFile)) return null;
	try {
		return JSON.parse(fs.readFileSync(discordIdFile, "UTF-8"));
	} catch (_) {
		return null;
	}
}

function saveDiscordUser(discordId, username, avatar) {
	if (!discordIdFile) return;
	fs.writeFileSync(discordIdFile, JSON.stringify({ discordId, username, avatar }));
}

// Mantém compatibilidade com código anterior
function saveDiscordId(id) {
	saveDiscordUser(id, null, null);
}

function clearDiscordId() {
	if (!discordIdFile) return;
	if (fs.existsSync(discordIdFile)) fs.unlinkSync(discordIdFile);
	if (_currentUuid) {
		_fbDelete(`/discordLinks/${_safeKey(_currentUuid)}`).catch(() => {});
	}
}

// ── Firebase helpers ──

function _safeKey(str) {
	return str.replace(/[.#$/[\]]/g, '_');
}

function _fbRequest(method, path, body) {
	return new Promise((resolve, reject) => {
		const url = new URL(`${FB_URL}${path}.json`);
		const data = body ? JSON.stringify(body) : null;
		const opts = {
			hostname: url.hostname,
			path: url.pathname + url.search,
			method,
			headers: { 'Content-Type': 'application/json' }
		};
		if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
		const req = https.request(opts, res => {
			let raw = '';
			res.on('data', c => raw += c);
			res.on('end', () => {
				try { resolve(JSON.parse(raw)); } catch { resolve(null); }
			});
		});
		req.on('error', reject);
		if (data) req.write(data);
		req.end();
	});
}

function _fbGet(path)         { return _fbRequest('GET',    path, null); }
function _fbPut(path, body)   { return _fbRequest('PUT',    path, body); }
function _fbDelete(path)      { return _fbRequest('DELETE', path, null); }

// Salva o vínculo do Discord no Firebase associado ao UUID do Minecraft
async function saveDiscordLinkToFirebase(uuid, discordId, username, avatar) {
	const uid = _safeKey(uuid);
	await _fbPut(`/discordLinks/${uid}`, {
		discordId,
		username: username || null,
		avatar: avatar || null,
		mcUuid: uuid,
		mcUsername: null, // será preenchido pelo activeAccount
		linkedAt: Date.now()
	});
}

// Carrega o vínculo do Discord do Firebase pelo UUID
async function getDiscordLinkFromFirebase(uuid) {
	if (!uuid) return null;
	const uid = _safeKey(uuid);
	const data = await _fbGet(`/discordLinks/${uid}`);
	return data || null;
}

// Remove o vínculo do Discord do Firebase
async function removeDiscordLinkFromFirebase(uuid) {
	if (!uuid) return;
	const uid = _safeKey(uuid);
	await _fbDelete(`/discordLinks/${uid}`);
}

// Faz uma requisição GET à API e retorna uma Promise com o JSON
function apiGet(endpoint) {
	return new Promise((resolve, reject) => {
		const url = API_BASE + endpoint;
		const isHttps = url.startsWith("https");
		const lib = isHttps ? https : http;

		const options = {
			headers: {
				"accept": "application/json",
				"x-api-key": API_KEY
			},
			timeout: 8000
		};

		const req = lib.get(url, options, (res) => {
			let raw = "";
			res.on("data", chunk => raw += chunk);
			res.on("end", () => {
				try {
					if (res.statusCode === 200) {
						resolve(JSON.parse(raw));
					} else {
						reject({ status: res.statusCode, body: raw });
					}
				} catch (e) {
					reject({ status: res.statusCode, body: raw, parseError: e.message });
				}
			});
		});

		req.on("error", reject);
		req.on("timeout", () => {
			req.destroy();
			reject(new Error("timeout"));
		});
	});
}

// Gera a URL OAuth do Discord para vincular o nick
// Retorna { url } — abrir no browser externo
function getDiscordAuthUrl(nick) {
	return apiGet(`/auth/discord?nick=${encodeURIComponent(nick)}`);
}

// Verifica se o nick já foi vinculado
// Retorna { vinculado: bool, discord_id?: string }
function checkAuthStatus(nick) {
	return apiGet(`/auth/status/${encodeURIComponent(nick)}`);
}

// Busca stats pelo Discord ID
function fetchStatsByDiscordId(discordId) {
	return apiGet(`/stats/${encodeURIComponent(discordId)}`);
}

// Busca saldo pelo nick do Minecraft
function fetchSaldoByNick(nick) {
	return apiGet(`/mc/saldo/${encodeURIComponent(nick)}`);
}

// Resgata um código
function resgatarCodigo(codigo) {
	return apiGet(`/resgatar/${encodeURIComponent(codigo)}`);
}

// Desvincula o Discord do nick
function unlinkDiscord(nick) {
	return apiGet(`/unlink/${encodeURIComponent(nick)}`);
}

module.exports = {
	init,
	setCurrentUuid,
	getSavedDiscordId,
	getSavedDiscordUser,
	saveDiscordId,
	saveDiscordUser,
	clearDiscordId,
	saveDiscordLinkToFirebase,
	getDiscordLinkFromFirebase,
	removeDiscordLinkFromFirebase,
	getDiscordAuthUrl,
	checkAuthStatus,
	fetchStatsByDiscordId,
	fetchSaldoByNick,
	resgatarCodigo,
	unlinkDiscord
};
