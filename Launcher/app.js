const Launcher = require("./launcher");
const Utils = require("./utils");
const Config = require("./config");
const Coins = require("./coins");
const launcher = Launcher.instance;
const { ipcRenderer, shell } = require("electron");
const { MicrosoftAuthService, OfflineAuthService, Account, AccountManager } = require("./auth");
const microsoftAuthService = MicrosoftAuthService.instance;
const offlineAuthService = OfflineAuthService.instance;
const fs = require("fs");
const msmc = require("msmc");
const os = require("os");
const nbt = require("nbt");
const path = require("path");
const xss = require("xss");
const https = require("https");

let Friends;
try {
	Friends = require("./friends");
} catch(e) {
	Friends = null;
}

Utils.init();
Config.init(Utils.dataDirectory);
Config.load();
Coins.init(Utils.dataDirectory);
if(Friends) Friends.init(Utils.dataDirectory);

ipcRenderer.on("close", (event) => {
	ipcRenderer.send("quit", launcher.games.length < 1);
});

ipcRenderer.on("quitGame", (event) => {
	for(let game of launcher.games) {
		game.kill();
	}
	launcher.games = [];
	ipcRenderer.send("quit", true);
});

// ── Bosta Client — GitHub Releases Feed ──
(function () {
	const RELEASES_URL = 'https://api.github.com/repos/Bosta-Client/Updates/releases';

	function formatDate(iso) {
		return new Date(iso).toLocaleDateString('pt-BR', {
			day: '2-digit', month: 'short', year: 'numeric'
		});
	}

	// Converte markdown simples em HTML
	function mdToHtml(text) {
		if (!text) return '';
		return text
			.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
			.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
			.replace(/\*(.+?)\*/g, '<em>$1</em>')
			.replace(/`(.+?)`/g, '<code class="inline-code">$1</code>')
			.replace(/^#{1,3} (.+)$/gm, '<span class="release-section">$1</span>')
			.replace(/^[-*] (.+)$/gm, '<span class="release-li"><span class="release-bullet">▸</span>$1</span>')
			.replace(/\n/g, '<br>');
	}

	function tagLabel(release) {
		if (release.prerelease) return { label: 'pre-release', color: '#fee75c' };
		const v = (release.tag_name || '').toLowerCase();
		if (v.includes('hotfix') || v.includes('fix')) return { label: 'correção', color: '#ed4245' };
		return { label: 'lançamento', color: '#57f287' };
	}

	function renderReleases(releases) {
		const feed    = document.getElementById('discordFeed');
		const loading = document.getElementById('discordFeedLoading');

		if (!feed || !loading) return;

		if (!releases.length) {
			loading.innerHTML = '<p class="empty-title">Nenhuma release ainda.</p>';
			return;
		}

		loading.style.display = 'none';

		const list = document.createElement('div');
		list.className = 'updates-list';

		list.innerHTML = releases.map(r => {
			const { label, color } = tagLabel(r);
			const body = mdToHtml(r.body);
			return `
				<div class="update-card">
					<div class="update-card-side" style="background:${color};"></div>
					<div class="update-card-body">
						<div class="update-card-meta">
							<span class="update-tag" style="color:${color}; border-color:${color}33;">${label}</span>
							<span class="update-version">${r.tag_name}</span>
							<span class="update-date">${formatDate(r.published_at)}</span>
							<a class="update-gh-link open-in-browser" href="${r.html_url}" title="Ver no GitHub">
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
							</a>
						</div>
						<p class="update-title">${r.name || r.tag_name}</p>
						${body ? `<div class="update-body">${body}</div>` : ''}
					</div>
				</div>
			`;
		}).join('');

		feed.appendChild(list);

		// Popula os news cards na home
		renderNewsCards(releases.slice(0, 3));
	}

	function renderNewsCards(releases) {
		const row = document.getElementById('newsCardsRow');
		if(!row) return;
		row.innerHTML = '';
		if(!releases.length) {
			row.innerHTML = '<div class="news-card-placeholder"><span style="font-size:0.75em;color:var(--w20);">Sem novidades</span></div>';
			return;
		}
		releases.forEach(r => {
			const { label, color } = tagLabel(r);
			const card = document.createElement('div');
			card.className = 'news-card';
			card.innerHTML = `
				<div class="news-card-thumb">
					<div class="news-card-thumb-placeholder">
						<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
							<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 0-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
						</svg>
					</div>
					<div style="position:absolute;bottom:6px;left:6px;">
						<span style="font-size:0.58em;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:${color};background:rgba(0,0,0,0.7);padding:2px 6px;border-radius:4px;">${label}</span>
					</div>
				</div>
				<div class="news-card-body">
					<div class="news-card-label">${formatDate(r.published_at)}</div>
					<div class="news-card-title">${r.name || r.tag_name}</div>
				</div>
			`;
			card.addEventListener('click', () => window.switchToTab('news'));
			row.appendChild(card);
		});
	}

	function loadReleases() {
		const feed    = document.getElementById('discordFeed');
		const loading = document.getElementById('discordFeedLoading');

		if (!feed || !loading) return;

		fetch(RELEASES_URL, { headers: { 'Accept': 'application/vnd.github+json' } })
			.then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
			.then(renderReleases)
			.catch(() => {
				loading.innerHTML = `
					<p class="empty-title">Sem conexão</p>
					<p class="empty-sub">Não foi possível carregar as atualizações.</p>`;
			});
	}

	window.loadReleases = loadReleases;
})();

// ── VERSION SELECTOR ─────────────────────
let _getCurrentVersion = () => "1.8.9";

function setupVersionSelector() {
	const VERSIONS = [
		"1.8.9", "1.9", "1.10", "1.11", "1.12", "1.13",
		"1.14", "1.15", "1.16", "1.17", "1.18", "1.19",
		"1.20", "1.21", "1.21.1", "1.21.4", "1.21.10"
	];

	const btn = document.getElementById("versionSelectorBtn");
	const display = document.getElementById("selectedVersionDisplay");
	const dropdown = document.getElementById("versionDropdown");
	const versionLine = document.getElementById("versionLineDisplay");
	let currentVersion = "1.8.9";
	let isOpen = false;

	_getCurrentVersion = () => currentVersion;

	function buildDropdown() {
		dropdown.innerHTML = "";
		VERSIONS.forEach(ver => {
			const opt = document.createElement("div");
			opt.className = "version-option" + (ver === currentVersion ? " selected" : "") + " dev-badge";
			opt.textContent = ver;
			opt.dataset.version = ver;
			opt.onclick = (e) => {
				e.stopPropagation();
				selectVersion(ver);
				closeDropdown();
			};
			dropdown.appendChild(opt);
		});
	}

	function selectVersion(ver) {
		currentVersion = ver;
		display.textContent = ver;
		if(versionLine) versionLine.textContent = ver;
		dropdown.querySelectorAll(".version-option").forEach(o => {
			o.classList.toggle("selected", o.dataset.version === ver);
		});
	}

	function toggleDropdown() {
		isOpen = !isOpen;
		if(isOpen) {
			buildDropdown();
			dropdown.classList.remove("invisible");
			const arrow = btn.querySelector(".version-arrow");
			if(arrow) arrow.classList.add("open");
		} else {
			closeDropdown();
		}
	}

	function closeDropdown() {
		isOpen = false;
		dropdown.classList.add("invisible");
		const arrow = btn.querySelector(".version-arrow");
		if(arrow) arrow.classList.remove("open");
	}

	if(btn && dropdown) {
		btn.onclick = (e) => {
			e.stopPropagation();
			toggleDropdown();
		};

		document.addEventListener("click", (e) => {
			if(isOpen && !btn.contains(e.target) && !dropdown.contains(e.target)) {
				closeDropdown();
			}
		});
	}
}

window.addEventListener("DOMContentLoaded", async() => {
	if(Utils.getOsName() == "osx") {
		document.querySelector(".drag-region").style.display = "block";
	}

	// Carrega as releases do GitHub
	window.loadReleases();

	// Inicializa o seletor de versão
	setupVersionSelector();

	const playButton = document.getElementById("launch-button");
	const launchNote = document.getElementById("launch-note");
	const microsoftLoginButton = document.querySelector(".microsoft-login-button");
	const offlineLoginButton = document.getElementById("offlineLoginBtn");
	const offlineModal = document.getElementById("offlineModal");
	const offlineUsernameInput = document.getElementById("offlineUsernameInput");
	const offlineModalConfirm = document.getElementById("offlineModalConfirm");
	const offlineModalCancel = document.getElementById("offlineModalCancel");
	const accountButton = document.querySelector(".brand-mark");

	const login = document.querySelector(".login");
	const main = document.querySelector(".main");
	const accounts = document.querySelector(".accounts");
	const backToMain = document.querySelector(".back-to-main-button");

	launcher.accountManager = new AccountManager(Utils.accountsFile, (account) => {
		if(account == launcher.accountManager.activeAccount) {
			updateAccount();
		}

		if(accounts.style.display === "block") {
			updateAccounts();
		}
	});

	for(let account of launcher.accountManager.accounts) {
		await launcher.accountManager.storeInKeychain(account);
	}

	// Sincroniza o UUID atual com o Firebase para o vínculo do Discord
	if(launcher.accountManager.activeAccount) {
		Coins.setCurrentUuid(launcher.accountManager.activeAccount.uuid);
	}

	function updateAccount() {
		if(launcher.accountManager.activeAccount) {
			const acc = launcher.accountManager.activeAccount;

			// Head avatar na right-panel
			[document.getElementById("rpHeadAvatar"), document.getElementById("rpDropdownAvatar")].forEach(el => {
				if(!el) return;
				let oldImg = el.querySelector("img");
				if(oldImg) oldImg.remove();
				let oldSvg = el.querySelector("svg");
				if(oldSvg) oldSvg.remove();
				let img = document.createElement("img");
				img.src = acc.head;
				img.style.width = "100%";
				img.style.height = "100%";
				img.style.objectFit = "cover";
				img.style.objectPosition = "center top";
				img.style.display = "block";
				img.style.borderRadius = "inherit";
				img.onerror = function() { this.style.display = "none"; };
				el.appendChild(img);
			});

			let nameEl = document.getElementById("rpDropdownName");
			if(nameEl) nameEl.textContent = acc.username;

			// Atualiza o nick no card do OAuth
			let oauthNick = document.getElementById("coinsOAuthNick");
			if(oauthNick) oauthNick.textContent = acc.username;

			// Inicia sistema de amigos
			if(Friends) {
				Friends.goOnline(acc.uuid, acc.username, acc.head);
				Friends.listenFriends(renderFriendsList);
				Friends.listenIncomingRequests(renderRequestsBadge);
				Friends.onNewMessage(handleNewMessage);
			}
		}
	}

	function updateMinecraftFolder() {
		let minecraftFolderPath = document.querySelector(".minecraft-folder-path");
		if(minecraftFolderPath) {
			minecraftFolderPath.innerText = Config.data.minecraftFolder ?? "(use default)";
		}
	}

	function updateJre() {
		let jreLocation = document.querySelector(".jre-location");
		if(jreLocation) {
			jreLocation.innerText = Config.data.jrePath ?? "(download automatically)";
		}
	}

	updateMinecraftFolder();
	updateJre();

	backToMain.onclick = () => {
		if(loggingIn) {
			return;
		}

		login.style.display = null;
		main.style.display = "block";
	};

	if(launcher.accountManager.activeAccount != null) {
		main.style.display = "block";
		updateAccount();
	}
	else {
		showLogin(false);
	}

	let launching = false;
	let loggingIn = false;

	// Helper: mostra a tela de login e garante que o dropdown fecha sempre
	function showLogin(showBack) {
		accounts.style.display = "none";
		main.style.display = null;
		login.style.display = "block";
		backToMain.style.display = showBack ? "block" : null;
	}

	function updateAccounts() {
		accounts.innerHTML = "";

		for(let account of launcher.accountManager.accounts) {
			let isActive = account === launcher.accountManager.activeAccount;
			let isOffline = account.type === "offline";

			// Head image: usa vzge.me para todos os tipos de conta
			let headSrc = account.head && account.head !== "headless.png"
				? account.head
				: `https://vzge.me/face/512/X-Steve`;

			let accountElement = document.createElement("div");
			accountElement.classList.add("acc-drop-item");
			if(isActive) accountElement.classList.add("current");

			accountElement.innerHTML = `
				<div class="acc-avatar-sm" style="overflow:hidden; padding:0; border-radius:4px; background:var(--surface);">
					<img src="${headSrc}" style="width:100%; height:100%; object-fit:cover; object-position:center top; image-rendering:auto;" onerror="this.style.display='none'; this.parentElement.textContent='${account.username[0].toUpperCase()}'"/>
				</div>
				<span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${account.username}</span>
				${isOffline ? '<span style="font-size:0.7em; opacity:0.45; margin-right:4px;">offline</span>' : ''}
				${isActive ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
				<button class="remove-account" style="background:none; border:none; cursor:pointer; padding:2px 4px; opacity:0.4; color:inherit; flex-shrink:0;" title="Remover conta">
					<img src="remove.svg" style="width:12px; height:12px; display:block;"/>
				</button>
			`;

			accountElement.onclick = async(event) => {
				if(event.target.classList.contains("remove-account")
						|| event.target.closest(".remove-account")) {
					if(!(await launcher.accountManager.removeAccount(account))) {
						showLogin(false);
					}
					else {
						updateAccounts();
					}
				}
				else {
					launcher.accountManager.switchAccount(account);
					Coins.setCurrentUuid(account.uuid);
					updateAccount();
					updateAccounts();
					updateHomeBalance();
				}
			};
			accounts.appendChild(accountElement);
		}

		// Divider
		let divider = document.createElement("div");
		divider.classList.add("acc-drop-divider");
		accounts.appendChild(divider);

		// Add account button
		let addElement = document.createElement("div");
		addElement.classList.add("acc-drop-action");
		addElement.innerHTML = `
			<img src="add.svg" style="width:14px; height:14px; opacity:0.6;"/>
			<span>Adicionar conta</span>
		`;
		addElement.onclick = () => {
			showLogin(true);
		};
		accounts.appendChild(addElement);
	}

	accountButton.addEventListener("click", (e) => {
		const isOpen = accounts.style.display === "block";
		if(isOpen) {
			accounts.style.display = "none";
		} else {
			updateAccounts();
			const rect = accountButton.getBoundingClientRect();
			// Abre para baixo, alinhado à direita do botão
			const dropW = 220;
			const leftPos = Math.max(4, rect.right - dropW);
			accounts.style.left = leftPos + "px";
			accounts.style.top = (rect.bottom + 6) + "px";
			accounts.style.bottom = "auto";
			accounts.style.display = "block";
		}
	});


	// ── Right‑panel head button → perfil dropdown ──
	const rpHeadBtn = document.getElementById("rpHeadBtn");
	const rpProfileDropdown = document.getElementById("rpProfileDropdown");
	if(rpHeadBtn && rpProfileDropdown) {
		rpHeadBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = rpProfileDropdown.style.display === "block";
			closeAllRpDropdowns();
			if(!open) {
				const rect = rpHeadBtn.getBoundingClientRect();
				rpProfileDropdown.style.left = (rect.left - 240 + rect.width) + "px";
				rpProfileDropdown.style.top = (rect.bottom + 4) + "px";
				rpProfileDropdown.style.display = "block";
			}
		});
		rpProfileDropdown.querySelectorAll(".rp-dropdown-item").forEach(item => {
			item.addEventListener("click", (e) => {
				e.stopPropagation();
				const action = item.dataset.action;
				rpProfileDropdown.style.display = "none";
				if(action === "profile") {
					// Ir para configurações (aba Launcher)
					const tab = document.querySelector(".settings-tab-btn");
					if(tab) tab.click();
				} else if(action === "settings") {
					const tab = document.querySelector(".settings-tab-btn");
					if(tab) tab.click();
				} else if(action === "logout") {
					// Logout direto (rpLogoutBtn removido)
					const totalAccounts = launcher.accountManager.accounts.length;
					if(totalAccounts === 0) return;
					const message = totalAccounts === 1
						? "Deseja sair desta conta?"
						: `Deseja sair de todas as ${totalAccounts} contas?`;
					if(!confirm(message)) return;
					const accountsToRemove = [...launcher.accountManager.accounts];
					accountsToRemove.forEach(account => {
						try { require("keytar").deletePassword("angel_client", account.uuid + "_access_token"); } catch(_) {}
						try { require("keytar").deletePassword("angel_client", account.uuid + "_refresh"); } catch(_) {}
					});
					launcher.accountManager.accounts = [];
					launcher.accountManager.activeAccount = null;
					launcher.accountManager.save();
					Coins.setCurrentUuid(null);
					if(Friends) { Friends.goOffline(); Friends.stopAllListeners(); }
					_cachedFriends = [];
					_unreadCounts = {};
					_currentRequests = [];
					updateMsgBadge();
					const reqBadge = document.getElementById("rpRequestsBadge");
					if(reqBadge) reqBadge.style.display = "none";
					const chatModal = document.getElementById("chatModal");
					if(chatModal) chatModal.classList.add("invisible");
					showLogin(false);
				}
			});
		});
	}

	// ── Right‑panel Bell (notificações) ──
	const rpBellBtn = document.getElementById("rpBellBtn");
	const rpNotifDropdown = document.getElementById("rpNotifDropdown");
	if(rpBellBtn && rpNotifDropdown) {
		rpBellBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = rpNotifDropdown.style.display === "block";
			closeAllRpDropdowns();
			if(!open) {
				const rect = rpBellBtn.getBoundingClientRect();
				rpNotifDropdown.style.left = (rect.left - 240 + rect.width) + "px";
				rpNotifDropdown.style.top = (rect.bottom + 4) + "px";
				rpNotifDropdown.style.display = "block";
			}
		});
	}

	// ── Right‑panel Friends ──
	const rpFriendsBtn = document.getElementById("rpFriendsBtn");
	const rpFriendsDropdown = document.getElementById("rpFriendsDropdown");
	if(rpFriendsBtn && rpFriendsDropdown) {
		rpFriendsBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = rpFriendsDropdown.style.display === "block";
			closeAllRpDropdowns();
			if(!open) {
				const rect = rpFriendsBtn.getBoundingClientRect();
				rpFriendsDropdown.style.left = (rect.left - 240 + rect.width) + "px";
				rpFriendsDropdown.style.top = (rect.bottom + 4) + "px";
				rpFriendsDropdown.style.display = "block";
			}
		});
		rpFriendsDropdown.querySelectorAll(".rp-dropdown-item").forEach(item => {
			item.addEventListener("click", (e) => {
				e.stopPropagation();
				rpFriendsDropdown.style.display = "none";
				const action = item.dataset.action;
			if(action === "add-friend") {
				openAddFriendModal();
			} else if(action === "requests") {
					openRequestsModal();
				}
			});
		});
	}

	// ── Right‑panel Messages ──
	const rpMsgBtn = document.getElementById("rpMsgBtn");
	const rpMsgDropdown = document.getElementById("rpMsgDropdown");
	if(rpMsgBtn && rpMsgDropdown) {
		rpMsgBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			const open = rpMsgDropdown.style.display === "block";
			closeAllRpDropdowns();
			if(!open) {
				const rect = rpMsgBtn.getBoundingClientRect();
				rpMsgDropdown.style.left = (rect.left - 240 + rect.width) + "px";
				rpMsgDropdown.style.top = (rect.bottom + 4) + "px";
				rpMsgDropdown.style.display = "block";
				loadMsgsList();
			}
		});
	}

	// Fecha todos os dropdowns do painel direito
	function closeAllRpDropdowns() {
		[rpProfileDropdown, rpNotifDropdown, rpFriendsDropdown, rpMsgDropdown].forEach(el => {
			if(el) el.style.display = "none";
		});
	}

	// Fecha dropdowns ao clicar fora
	document.addEventListener("click", (e) => {
		const rp = document.querySelector(".right-panel");
		const dropdowns = [rpProfileDropdown, rpNotifDropdown, rpFriendsDropdown, rpMsgDropdown].filter(Boolean);
		const clickedInside = (rp && rp.contains(e.target)) || dropdowns.some(d => d && d.contains(e.target));
		if(!clickedInside) {
			closeAllRpDropdowns();
		}
		// Fecha account dropdown ao clicar fora
		if(accounts && accounts.style.display === "block" && e.target !== accountButton && !accounts.contains(e.target)) {
			accounts.style.display = "none";
		}
	});

	// ── Botão "Adicionar" no dropdown de amigos ──
	const rpAddFriendBtn = document.getElementById("rpAddFriendBtn");
	if(rpAddFriendBtn) {
		rpAddFriendBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			openAddFriendModal();
		});
	}

	// ═══════════════════════════════════════
	//  SISTEMA DE AMIGOS / CHAT — HELPERS
	// ═══════════════════════════════════════

	let _chatPartnerUuid = null;
	let _currentRequests = [];
	let _unreadCounts = {};
	let _cachedFriends = [];

	function renderFriendsList(friends) {
		_cachedFriends = friends || [];
		const list = document.getElementById("rpFriendsList");
		if(!list) return;
		if(!friends || friends.length === 0) {
			list.innerHTML = '<div class="rp-dropdown-empty"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg><span>Nenhum amigo</span></div>';
			return;
		}
		list.innerHTML = friends.map(f =>
			'<div class="rp-friend-item" data-uuid="' + f.uuid + '">' +
				'<div class="rp-friend-avatar">' + (f.head ? '<img src="' + f.head + '"/>' : (f.username ? f.username[0].toUpperCase() : '?')) + '</div>' +
				'<div class="rp-friend-info">' +
					'<div class="rp-friend-name">' + xss(f.username) + '</div>' +
					'<div class="rp-friend-status' + (f.online ? ' online' : '') + '">' + (f.online ? (f.server ? 'Online — ' + xss(f.server) : 'Online') : 'Offline') + '</div>' +
				'</div>' +
				'<div class="rp-friend-dot' + (f.online ? ' online' : '') + '"></div>' +
			'</div>'
		).join("");

		list.querySelectorAll(".rp-friend-item").forEach(el => {
			el.addEventListener("click", () => {
				const uuid = el.dataset.uuid;
				const friend = friends.find(f => f.uuid === uuid);
				if(friend) openChat(friend);
			});
		});
	}

	function renderRequestsBadge(requests) {
		_currentRequests = requests || [];
		const badge = document.getElementById("rpRequestsBadge");
		if(!badge) return;
		if(_currentRequests.length > 0) {
			badge.textContent = _currentRequests.length;
			badge.style.display = "inline";
		} else {
			badge.style.display = "none";
		}
	}

	function handleNewMessage(fromUsername, fromHead, text, friendUuid) {
		_unreadCounts[friendUuid] = (_unreadCounts[friendUuid] || 0) + 1;
		updateMsgBadge();
	}

	function updateMsgBadge() {
		const total = Object.values(_unreadCounts).reduce((a, b) => a + b, 0);
		const btn = document.getElementById("rpMsgBtn");
		if(!btn) return;
		let badge = btn.querySelector(".rp-badge-rp");
		if(total > 0) {
			if(!badge) {
				badge = document.createElement("span");
				badge.className = "rp-badge rp-badge-rp";
				badge.style.position = "absolute";
				badge.style.top = "-2px";
				badge.style.right = "-2px";
				badge.style.fontSize = "0.55em";
				btn.style.position = "relative";
				btn.appendChild(badge);
			}
			badge.textContent = total > 99 ? "99+" : total;
		} else if(badge) {
			badge.remove();
		}
	}

	function openChat(friend) {
		const rpMsgDropdown = document.getElementById("rpMsgDropdown");
		if(rpMsgDropdown) rpMsgDropdown.style.display = "none";

		_chatPartnerUuid = friend.uuid;
		document.getElementById("chatModalTitle").textContent = friend.username;

		delete _unreadCounts[friend.uuid];
		updateMsgBadge();

		document.getElementById("chatModal").classList.remove("invisible");
		document.getElementById("chatMsgs").innerHTML = '<div class="chat-loading">Carregando...</div>';
		document.getElementById("chatInput").value = "";
		setTimeout(() => document.getElementById("chatInput").focus(), 100);

		updateChatHeaderStatus();

		if(!Friends) return;
		Friends.listenChat(friend.uuid, (msgs) => {
			renderChatMessages(friend, msgs);
			updateChatHeaderStatus();
		});
	}

	function updateChatHeaderStatus() {
		const dot = document.getElementById("chatStatusDot");
		const txt = document.getElementById("chatStatusText");
		if(!dot || !txt) return;
		if(!_chatPartnerUuid || !_cachedFriends) {
			dot.className = "chat-status-dot";
			txt.textContent = "";
			return;
		}
		const friend = _cachedFriends.find(f => f.uuid === _chatPartnerUuid);
		if(!friend) {
			dot.className = "chat-status-dot";
			txt.textContent = "";
			return;
		}
		if(friend.online) {
			dot.className = "chat-status-dot online";
			txt.className = "chat-status-text online";
			txt.textContent = friend.server ? 'Online — ' + friend.server : 'Online';
		} else {
			dot.className = "chat-status-dot";
			txt.className = "chat-status-text";
			txt.textContent = "Offline";
		}
	}

	function renderChatMessages(friend, msgs) {
		const container = document.getElementById("chatMsgs");
		if(!container) return;
		if(!msgs || msgs.length === 0) {
			container.innerHTML = '<div class="chat-loading">Nenhuma mensagem ainda. Envie algo!</div>';
			return;
		}

		const myUuid = Friends ? Friends.getMyUuid() : null;
		const autoScroll = container.scrollTop + container.clientHeight >= container.scrollHeight - 50;

		let html = msgs.map(m => {
			const isMine = m.from === myUuid;
			const time = m.ts ? new Date(m.ts).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' }) : "";
			return '<div class="chat-msg ' + (isMine ? 'mine' : 'other') + '"><div>' + xss(m.text || "") + '</div><div class="chat-msg-info">' + time + '</div></div>';
		}).join("");

		container.innerHTML = html;
		if(autoScroll) container.scrollTop = container.scrollHeight;
	}

	function loadMsgsList() {
		const list = document.getElementById("rpMsgsList");
		if(!list || !Friends) return;
		const friends = _cachedFriends;
		if(!friends || friends.length === 0) {
			list.innerHTML = '<div class="rp-dropdown-empty"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Nenhuma conversa</span></div>';
			return;
		}

		Promise.all(friends.map(async f => {
			try {
				const roomId = Friends.chatRoomId(Friends.getMyUuid(), f.uuid);
				const data = await Friends.dbGet('/chats/' + roomId + '/messages');
				if(!data) return { ...f, lastMsg: null, lastTs: 0 };
				const msgs = Object.entries(data).map(([id, v]) => ({ id, ...v })).sort((a, b) => (a.ts || 0) - (b.ts || 0));
				const last = msgs[msgs.length - 1];
				return { ...f, lastMsg: last ? (last.from === Friends.getMyUuid() ? 'Você: ' + last.text : last.text) : null, lastTs: last ? last.ts : 0 };
			} catch(_) {
				return { ...f, lastMsg: null, lastTs: 0 };
			}
		})).then(results => {
			results.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));
			list.innerHTML = results.map(f =>
				'<div class="rp-msg-item" data-uuid="' + f.uuid + '">' +
					'<div class="rp-friend-avatar">' + (f.head ? '<img src="' + f.head + '"/>' : (f.username ? f.username[0].toUpperCase() : '?')) + '</div>' +
					'<div class="rp-friend-info">' +
						'<div class="rp-friend-name">' + xss(f.username) + '</div>' +
						(f.lastMsg ? '<div class="rp-msg-preview">' + xss(f.lastMsg) + '</div>' : '<div class="rp-msg-preview" style="opacity:0.35;">' + (f.online ? (f.server ? 'Online — ' + xss(f.server) : 'Online') : 'Offline') + '</div>') +
					'</div>' +
					'<div class="rp-friend-dot' + (f.online ? ' online' : '') + '"></div>' +
				'</div>'
			).join("");

			list.querySelectorAll(".rp-msg-item").forEach(el => {
				el.addEventListener("click", () => {
					const uuid = el.dataset.uuid;
					const friend = friends.find(f => f.uuid === uuid);
					if(friend) openChat(friend);
				});
			});
		});
	}

	function openRequestsModal() {
		document.getElementById("requestsModal").classList.remove("invisible");
		renderRequestsModal();
	}

	function renderRequestsModal() {
		const list = document.getElementById("requestsList");
		if(!list) return;
		if(_currentRequests.length === 0) {
			list.innerHTML = '<div class="requests-empty">Nenhuma solicitação pendente</div>';
			return;
		}
		list.innerHTML = _currentRequests.map((r, i) =>
			'<div class="request-item" data-idx="' + i + '">' +
				'<div class="rp-friend-avatar">' + (r.fromHead ? '<img src="' + r.fromHead + '"/>' : (r.fromUsername ? r.fromUsername[0].toUpperCase() : '?')) + '</div>' +
				'<div class="rp-friend-name" style="font-size:0.8em;">' + xss(r.fromUsername || r.fromUuid) + '</div>' +
				'<div class="request-item-actions">' +
					'<button class="btn btn-primary btn-sm req-accept-btn" data-idx="' + i + '" style="font-size:0.65em;padding:3px 10px;">Aceitar</button>' +
					'<button class="btn btn-ghost btn-sm req-decline-btn" data-idx="' + i + '" style="font-size:0.65em;padding:3px 10px;">Recusar</button>' +
				'</div>' +
			'</div>'
		).join("");

		list.querySelectorAll(".req-accept-btn").forEach(btn => {
			btn.addEventListener("click", async (e) => {
				e.stopPropagation();
				const idx = parseInt(btn.dataset.idx, 10);
				const req = _currentRequests[idx];
				if(!req || !Friends) return;
				await Friends.acceptFriendRequest(req.fromUuid);
				_currentRequests.splice(idx, 1);
				renderRequestsModal();
				renderRequestsBadge(_currentRequests);
			});
		});
		list.querySelectorAll(".req-decline-btn").forEach(btn => {
			btn.addEventListener("click", async (e) => {
				e.stopPropagation();
				const idx = parseInt(btn.dataset.idx, 10);
				const req = _currentRequests[idx];
				if(!req || !Friends) return;
				await Friends.declineFriendRequest(req.fromUuid);
				_currentRequests.splice(idx, 1);
				renderRequestsModal();
				renderRequestsBadge(_currentRequests);
			});
		});
	}

	// ── Chat Modal ──
	const chatModal = document.getElementById("chatModal");
	const chatCloseBtn = document.getElementById("chatCloseBtn");
	const chatSendBtn = document.getElementById("chatSendBtn");
	const chatInput = document.getElementById("chatInput");

	if(chatCloseBtn) {
		chatCloseBtn.addEventListener("click", () => {
			chatModal.classList.add("invisible");
			if(Friends) Friends.stopListenChat();
			_chatPartnerUuid = null;
			updateChatHeaderStatus();
		});
	}

	if(chatSendBtn && chatInput) {
		chatSendBtn.addEventListener("click", sendChatMessage);
		chatInput.addEventListener("keydown", (e) => {
			if(e.key === "Enter") sendChatMessage();
		});
	}

	function sendChatMessage() {
		if(!_chatPartnerUuid || !Friends) return;
		const text = chatInput.value.trim();
		if(!text) return;
		Friends.sendMessage(_chatPartnerUuid, text);
		chatInput.value = "";
	}

	// ── Requests Modal ──
	const requestsModal = document.getElementById("requestsModal");
	const cancelRequestsBtn = document.getElementById("cancelRequestsBtn");
	if(cancelRequestsBtn) {
		cancelRequestsBtn.addEventListener("click", () => {
			requestsModal.classList.add("invisible");
		});
	}

	// ── Add Friend Modal ──
	const addFriendModal = document.getElementById("addFriendModal");
	const addFriendInput = document.getElementById("addFriendInput");
	const addFriendStatus = document.getElementById("addFriendStatus");
	const addFriendConfirmBtn = document.getElementById("addFriendConfirmBtn");
	const addFriendCancelBtn = document.getElementById("addFriendCancelBtn");

	function openAddFriendModal() {
		if(!Friends) { alert("Sistema de amigos indisponível."); return; }
		addFriendInput.value = "";
		addFriendStatus.textContent = "";
		addFriendConfirmBtn.disabled = false;
		addFriendModal.classList.remove("invisible");
		setTimeout(() => addFriendInput.focus(), 100);
	}

	if(addFriendCancelBtn) {
		addFriendCancelBtn.addEventListener("click", () => {
			addFriendModal.classList.add("invisible");
		});
	}

	if(addFriendConfirmBtn && addFriendInput) {
		addFriendConfirmBtn.addEventListener("click", () => {
			doAddFriend();
		});
		addFriendInput.addEventListener("keydown", (e) => {
			if(e.key === "Enter") doAddFriend();
		});
	}

	function doAddFriend() {
		const nick = addFriendInput.value.trim();
		if(!nick) { addFriendStatus.textContent = "Digite um nick."; return; }
		addFriendStatus.textContent = "Buscando...";
		addFriendConfirmBtn.disabled = true;
		Friends.findUserByUsername(nick).then(user => {
			if(!user) {
				addFriendStatus.textContent = "Usuário não encontrado!";
				addFriendConfirmBtn.disabled = false;
				return;
			}
			if(user.uuid === Friends.getMyUuid()) {
				addFriendStatus.textContent = "Você não pode se adicionar.";
				addFriendConfirmBtn.disabled = false;
				return;
			}
			Friends.sendFriendRequest(user.uuid).then(res => {
				if(res.error) {
					addFriendStatus.textContent = res.error;
					addFriendConfirmBtn.disabled = false;
					return;
				}
				if(res.auto) {
					addFriendStatus.textContent = `Você e ${user.username} agora são amigos!`;
				} else {
					addFriendStatus.textContent = `Solicitação enviada para ${user.username}!`;
				}
				setTimeout(() => addFriendModal.classList.add("invisible"), 1200);
			});
		}).catch(() => {
			addFriendStatus.textContent = "Erro ao buscar usuário.";
			addFriendConfirmBtn.disabled = false;
		});
	}

	// Fechar modais ao clicar fora do conteúdo
	document.querySelectorAll(".modal-overlay").forEach(overlay => {
		overlay.addEventListener("click", (e) => {
			if(e.target === overlay) overlay.classList.add("invisible");
		});
	});

	// ═══════════════════════════════════════
	const playAccBtn = document.getElementById("playAccountBtn");
	const playAccDropdown = document.getElementById("playAccountDropdown");
	let playAccOpen = false;

	function buildPlayAccountDropdown() {
		playAccDropdown.innerHTML = "";
		const accs = launcher.accountManager.accounts;
		if(accs.length === 0) {
			const empty = document.createElement("div");
			empty.style.cssText = "padding:12px;text-align:center;font-size:0.75em;color:rgba(255,255,255,0.35);";
			empty.textContent = "Nenhuma conta";
			playAccDropdown.appendChild(empty);
			return;
		}
		accs.forEach(acc => {
			const isActive = acc === launcher.accountManager.activeAccount;
			const isOffline = acc.type === "offline";
			const opt = document.createElement("div");
			opt.className = "play-acc-option" + (isActive ? " current" : "");

			const avatar = document.createElement("div");
			avatar.className = "play-acc-avatar";
			const img = document.createElement("img");
			img.src = acc.head || "https://vzge.me/face/512/X-Steve";
			img.onerror = function() { this.style.display = "none"; this.parentElement.textContent = acc.username[0].toUpperCase(); };
			avatar.appendChild(img);

			const name = document.createElement("span");
			name.className = "play-acc-name";
			name.textContent = acc.username;

			opt.appendChild(avatar);
			opt.appendChild(name);

			if(isOffline) {
				const badge = document.createElement("span");
				badge.style.cssText = "font-size:0.7em;opacity:0.45;margin-right:4px;";
				badge.textContent = "offline";
				opt.appendChild(badge);
			}

			if(isActive) {
				const check = document.createElement("span");
				check.className = "play-acc-check";
				check.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>';
				opt.appendChild(check);
			}

			opt.onclick = () => {
				if(acc !== launcher.accountManager.activeAccount) {
					launcher.accountManager.switchAccount(acc);
					Coins.setCurrentUuid(acc.uuid);
					updateAccount();
					updateHomeBalance();
				}
				closePlayAccountDropdown();
			};
			playAccDropdown.appendChild(opt);
		});

		const divider = document.createElement("div");
		divider.className = "play-acc-divider";
		playAccDropdown.appendChild(divider);

		const addOpt = document.createElement("div");
		addOpt.className = "play-acc-add";
		addOpt.innerHTML = '<img src="add.svg" style="width:14px;height:14px;opacity:0.6;"/> <span>Adicionar conta</span>';
		addOpt.onclick = () => {
			closePlayAccountDropdown();
			showLogin(true);
		};
		playAccDropdown.appendChild(addOpt);
	}

	function togglePlayAccountDropdown() {
		playAccOpen = !playAccOpen;
		if(playAccOpen) {
			buildPlayAccountDropdown();
			playAccDropdown.classList.remove("invisible");
			playAccBtn.classList.add("active");
		} else {
			closePlayAccountDropdown();
		}
	}

	function closePlayAccountDropdown() {
		playAccOpen = false;
		playAccDropdown.classList.add("invisible");
		playAccBtn.classList.remove("active");
	}

	if(playAccBtn && playAccDropdown) {
		playAccBtn.onclick = (e) => {
			e.stopPropagation();
			togglePlayAccountDropdown();
		};

		document.addEventListener("click", (e) => {
			if(playAccOpen && !playAccBtn.contains(e.target) && !playAccDropdown.contains(e.target)) {
				closePlayAccountDropdown();
			}
		});
	}

	microsoftLoginButton.onclick = () => {
		if(!loggingIn) {
			loggingIn = true;
			microsoftLoginButton.innerText = "...";
			ipcRenderer.send("msa");
		}
	};

	// ── Offline login ──
	offlineLoginButton.onclick = () => {
		offlineUsernameInput.value = "";
		offlineModal.style.display = "flex";
		setTimeout(() => offlineUsernameInput.focus(), 50);
	};

	offlineModalCancel.onclick = () => {
		offlineModal.style.display = "none";
	};

	offlineModal.addEventListener("keydown", (e) => {
		if(e.key === "Enter") offlineModalConfirm.click();
		if(e.key === "Escape") offlineModalCancel.click();
	});

	offlineModalConfirm.onclick = async() => {
		let username = offlineUsernameInput.value.trim();
		if(!username || username.length < 1) {
			offlineUsernameInput.focus();
			return;
		}
		offlineModal.style.display = "none";
		let account = await offlineAuthService.authenticate(username);
		launcher.accountManager.addAccount(account);
		Coins.setCurrentUuid(account.uuid);
		accounts.style.display = "none";
		login.style.display = "none";
		main.style.display = "block";
		updateAccount();
		updateAccounts();
	};

	ipcRenderer.on("msa", async(event, result) => {
		loggingIn = false;
		microsoftLoginButton.innerHTML = `<svg width="16" height="16" viewBox="0 0 23 23" fill="none">
			<rect x="1" y="1" width="10" height="10" fill="#f25022"/>
			<rect x="12" y="1" width="10" height="10" fill="#7fba00"/>
			<rect x="1" y="12" width="10" height="10" fill="#00a4ef"/>
			<rect x="12" y="12" width="10" height="10" fill="#ffb900"/>
		</svg> Entrar com Microsoft`;
		result = JSON.parse(result);
		if(msmc.errorCheck(result)) {
			if(result.type == "Cancelled") {
				return;
			}
			alert("Could not log in: " + result.type);
			return;
		}
		let account = await microsoftAuthService.authenticate(result.profile);
		launcher.accountManager.addAccount(account);
		Coins.setCurrentUuid(account.uuid);
		accounts.style.display = "none";
		login.style.display = "none";
		main.style.display = "block";
		updateAccount();
		updateAccounts();
	});

	const progressContainer = document.getElementById("progress-container");
	const progressFill = document.getElementById("progressFill");
	const progressLabel = document.getElementById("progressLabel");

	function showProgress(show) {
		if(show) {
			progressContainer.classList.remove("invisible");
			progressContainer.style.display = "flex";
		}
		else {
			progressContainer.classList.add("invisible");
			progressContainer.style.display = "none";
		}
	}

	function updateProgress(data) {
		if(typeof data === "string") {
			progressLabel.textContent = data;
		}
		else if(data && typeof data === "object") {
			if(data.text) progressLabel.textContent = data.text;
			if(data.percent != null) {
				progressFill.style.width = Math.min(data.percent, 100) + "%";
			}
		}
	}

	async function play(server) {
		if(!launching) {
			if(launcher.games.length > 0) {
				launchNote.style.display = "inline";
				launchNote.innerText = "Um jogo já está rodando";
				setTimeout(() => {
					launchNote.style.display = null;
				}, 3000);
				return;
			}

			// Atualiza presença: servidor atual
			if(Friends && launcher.accountManager.activeAccount) {
				Friends.setCurrentServer(server || null);
			}

			launching = true;

			launchNote.style.display = "none";
			playButton.disabled = true;
			playButton.innerText = "...";
			showProgress(true);
			updateProgress({ text: "Refreshing login...", percent: 0 });
			try {
				if(launcher.accountManager.activeAccount.type !== "offline") {
					await launcher.accountManager.refreshAccount(launcher.accountManager.activeAccount);
				}
			}
			catch(error) {
				console.error(error);
				if(launcher.accountManager.activeAccount) {
					updateAccount();
				}

				showLogin(launcher.accountManager.accounts.length > 0);
				playButton.disabled = false;
				playButton.innerText = "Play";
				launching = false;
				showProgress(false);
				launchNote.style.display = null;
				return;
			}
			launcher.launch(() => {
				showProgress(false);
				playButton.disabled = false;
				playButton.innerText = "Play";
				launching = false;
				launchNote.style.display = null;
				// Jogo fechou — limpa servidor atual
				if(Friends) Friends.setCurrentServer(null);
			}, (data) => updateProgress(data), server);
		}
	}

	playButton.onclick = () => {
		const version = _getCurrentVersion();
		if(version !== "1.8.9") {
			const note = document.getElementById("launch-note");
			if(note) {
				note.textContent = "⚠ Versão " + version + " em desenvolvimento";
				note.style.display = "inline";
				setTimeout(() => { note.style.display = "none"; }, 4000);
			}
			return;
		}
		play();
	};

	// Settings buttons
	let minecraftFolderBtn = document.querySelector(".minecraft-folder");
	if(minecraftFolderBtn) {
		minecraftFolderBtn.onclick = () => ipcRenderer.send("directory", "Select Minecraft Folder", "minecraft");
	}

	let jreLocationChangeBtn = document.querySelector(".jre-location-change");
	if(jreLocationChangeBtn) {
		jreLocationChangeBtn.onclick = () => ipcRenderer.send("directory", "Select JRE Folder", "jre");
	}

	let jreLocationResetBtn = document.querySelector(".jre-location-reset");
	if(jreLocationResetBtn) {
		jreLocationResetBtn.onclick = () => {
			Config.data.jrePath = null;
			Config.save();
			updateJre();
		};
	}

	ipcRenderer.on("directory", (event, file, id) => {
		switch(id) {
			case "minecraft":
				Config.data.minecraftFolder = file;
				Config.save();
				updateMinecraftFolder();
				updateServers();
				break;
			case "jre":
				if(!fs.existsSync(path.join(file, "bin/java"))) {
					ipcRenderer.send("jreError");
					return;
				}
				Config.data.jrePath = file;
				Config.save();
				updateJre();
				break;
		}
	});

	let devtoolsBtn = document.querySelector(".devtools");
	if(devtoolsBtn) {
		devtoolsBtn.onclick = () => ipcRenderer.send("devtools");
	}

	// Busca ícone do servidor via mcsrvstat.us usando Node https (sem depender do fetch do browser)
	function fetchServerIcon(addr, iconEl) {
		const url = `https://api.mcsrvstat.us/3/${encodeURIComponent(addr)}`;
		https.get(url, { headers: { "User-Agent": "BostaClient/1.0" } }, (res) => {
			let raw = "";
			res.on("data", chunk => raw += chunk);
			res.on("end", () => {
				try {
					const data = JSON.parse(raw);
					if(data && data.icon) {
						iconEl.innerHTML = `<img src="${data.icon}" style="width:100%; height:100%; border-radius:6px; image-rendering:pixelated;">`;
					}
				} catch(e) {}
			});
		}).on("error", () => {});
	}

	function updateServers() {
		let serversFile = Config.getGameDirectory(Utils.gameDirectory) + "/servers.dat";

		// Ensure savedServers array exists
		if(!Array.isArray(Config.data.savedServers)) {
			Config.data.savedServers = [];
		}

		let allServers = [];

		function finalize() {
			renderQuickServerBar(allServers);
		}

		// Servidores salvos manualmente
		let savedServers = Config.data.savedServers;
		for(let i = 0; i < savedServers.length; i++) {
			allServers.push({
				name: savedServers[i].name || "Servidor",
				addr: savedServers[i].addr || "localhost",
				icon: null,
				source: "custom",
				index: i
			});
		}

		// Servidores do servers.dat do Minecraft
		if(fs.existsSync(serversFile)) {
			try {
				nbt.parse(fs.readFileSync(serversFile), (error, data) => {
					if(!error) {
						let mcServers = [];
						if(data.value.servers && data.value.servers.value && data.value.servers.value.value) {
							mcServers = data.value.servers.value.value;
						}
						for(let i = 0; i < mcServers.length && allServers.length < 9; i++) {
							let s = mcServers[i];
							allServers.push({
								name: s.name ? s.name.value : "Servidor",
								addr: s.ip ? s.ip.value : "localhost",
								icon: s.icon ? s.icon.value : null,
								source: "minecraft",
								index: i
							});
						}
					}
					finalize();
				});
			} catch(err) {
				console.error("Error loading servers:", err);
				finalize();
			}
		} else {
			finalize();
		}
	}

	// Expõe a função globalmente para ser usada pelo ui.js
	window.updateServers = updateServers;

	// ── Barra de servidores rápidos (abaixo do Play) ──
	let deleteModeActive = false;

	updateServers();

	function renderQuickServerBar(servers) {
		const bar = document.getElementById("quickServerBar");
		if(!bar) return;
		bar.innerHTML = "";

		if(!Array.isArray(servers)) {
			servers = [];
		}

		// Remove delete mode class
		bar.classList.toggle("delete-mode", deleteModeActive);

		// Preenche os slots: 9 slots de servidor/+ + 1 gear
		for(let slot = 0; slot < 9; slot++) {
			const item = document.createElement("div");
			item.className = "quick-server-bar-item";

			if(slot < servers.length) {
				// Slot com servidor
				const srv = servers[slot];

				const iconWrap = document.createElement("div");
				iconWrap.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;";

				if(srv.icon) {
					iconWrap.innerHTML = `<img src="data:image/png;base64,${srv.icon}" style="width:100%;height:100%;border-radius:7px;image-rendering:pixelated;">`;
				} else {
					iconWrap.textContent = "?";
					iconWrap.style.color = "var(--w20)";
					iconWrap.style.fontSize = "11px";
					fetchServerIcon(srv.addr, iconWrap);
				}
				item.appendChild(iconWrap);

				// Bolinha vermelha de exclusão (sempre presente, visível apenas em delete mode via CSS)
				const badge = document.createElement("div");
				badge.className = "quick-server-bar-badge";
				badge.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
				item.appendChild(badge);

				item.title = srv.name + "\n" + srv.addr;

				// Clique: se delete mode ativo -> confirma exclusão; senão -> jogar
				item.onclick = () => {
					if(deleteModeActive) {
						// Abre modal de confirmação
						const modal = document.getElementById("deleteServerModal");
						const sub = document.getElementById("deleteServerModalSub");
						if(sub) sub.textContent = `Tem certeza que deseja excluir "${srv.name}"?`;
						if(modal) {
							modal._deleteTarget = { source: srv.source, index: srv.index };
							modal.classList.remove("invisible");
						}
					} else {
						play(srv.addr);
					}
				};
			} else {
				// Slot vazio com +
				item.classList.add("plus-slot");
				const plus = document.createElement("span");
				plus.className = "quick-server-bar-plus";
				plus.textContent = "+";
				item.appendChild(plus);
				item.title = "Adicionar servidor";
				item.onclick = () => {
					const modal = document.getElementById("addServerModal");
					const nameInput = document.getElementById("serverNameInput");
					const addrInput = document.getElementById("serverAddrInput");
					if(nameInput) nameInput.value = "";
					if(addrInput) addrInput.value = "";
					if(modal) {
						modal.classList.remove("invisible");
						setTimeout(() => { if(nameInput) nameInput.focus(); }, 50);
					}
				};
			}

			bar.appendChild(item);
		}

		// Gear button (substitui o 9º slot quando deleteMode)
		let gear = bar.querySelector(".quick-server-bar-gear");
		if(!gear) {
			gear = document.createElement("button");
			gear.className = "quick-server-bar-gear";
			bar.appendChild(gear);
		}
		gear.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
		gear.classList.toggle("active", deleteModeActive);
		gear.title = deleteModeActive ? "Sair do modo de exclusão" : "Modo de exclusão";
		gear.onclick = (e) => {
			e.stopPropagation();
			deleteModeActive = !deleteModeActive;
			renderQuickServerBar(servers);
		};
	}

	// ── Modal de exclusão de servidor ──
	{
		const deleteModal = document.getElementById("deleteServerModal");
		const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
		const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");
		if(cancelDeleteBtn && deleteModal) {
			cancelDeleteBtn.onclick = () => deleteModal.classList.add("invisible");
		}
		if(deleteModal) {
			deleteModal.addEventListener("keydown", (e) => {
				if(e.key === "Escape") deleteModal.classList.add("invisible");
			});
			deleteModal.onclick = (e) => {
				if(e.target === deleteModal) deleteModal.classList.add("invisible");
			};
		}
		if(confirmDeleteBtn && deleteModal) {
			confirmDeleteBtn.onclick = () => {
				const target = deleteModal._deleteTarget;
				if(target && target.source === "custom") {
					Config.data.savedServers.splice(target.index, 1);
					Config.save();
				}
				deleteModal.classList.add("invisible");
				deleteModal._deleteTarget = null;
				deleteModeActive = false;
				updateServers();
			};
		}
	}

	// ── Carrossel de banners ──
	(function() {
		const track = document.getElementById('carouselTrack');
		const prevBtn = document.getElementById('carouselPrev');
		const nextBtn = document.getElementById('carouselNext');
		const playLogo = document.querySelector('.play-logo');
		if(!track) return;

		// Lê a pasta banners/ e monta os slides
		const bannersDir = path.join(__dirname, 'banners');
		let images = [];
		try {
			images = fs.readdirSync(bannersDir)
				.filter(f => /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f))
				.map(f => 'banners/' + f);
		} catch(e) {}

		const logoSlide = '<div class="carousel-slide"><img src="assets/angel_client_logo_with_text.svg" class="carousel-logo" alt="Bosta Client"/></div>';

		if(images.length === 0) {
			// Sem banners: mostra só a logo como slide único
			track.innerHTML = logoSlide;
			track.querySelector('.carousel-slide').classList.add('active');
			if(playLogo) playLogo.style.display = 'none';
			if(prevBtn) prevBtn.style.display = 'none';
			if(nextBtn) nextBtn.style.display = 'none';
			return;
		}

		// Com banners: esconde a logo (já aparece no carrossel)
		if(playLogo) playLogo.style.display = 'none';

		// Adiciona a logo como slide extra se tiver só 1 banner
		if(images.length === 1) {
			images.push('assets/angel_client_logo_with_text.svg');
		}

		// Substitui o conteúdo do track pelos slides das imagens
		track.innerHTML = images.map((src, i) => {
			const isLogo = src.includes('logo');
			return `
			<div class="carousel-slide${i === 0 ? ' active' : ''}">
				${isLogo ? `<img src="${src}" class="carousel-logo" alt="Bosta Client"/>` : `<img src="${src}" class="carousel-banner-img" alt="banner ${i+1}"/>`}
				${isLogo ? '' : '<a class="carousel-learn-more" href="https://angelclient.xyz" target="_blank">LER MAIS</a>'}
			</div>`;
		}).join('');

		let current = 0;
		const slides = track.querySelectorAll('.carousel-slide');

		function goTo(index) {
			slides[current].classList.remove('active');
			current = (index + slides.length) % slides.length;
			slides[current].classList.add('active');
		}

		if(prevBtn) prevBtn.onclick = () => goTo(current - 1);
		if(nextBtn) nextBtn.onclick = () => goTo(current + 1);

		// Auto-avança a cada 5 segundos
		setInterval(() => goTo(current + 1), 5000);
	})();

	// ── Settings tab switching ──
	(function() {
		const navBtns = document.querySelectorAll(".settings-nav-item");
		const pages = document.querySelectorAll(".settings-page");
		if(navBtns.length === 0 || pages.length === 0) return;
		navBtns.forEach(btn => {
			btn.addEventListener("click", () => {
				const tab = btn.dataset.stab;
				navBtns.forEach(b => b.classList.remove("selected"));
				btn.classList.add("selected");
				pages.forEach(p => p.classList.remove("visible"));
				const target = document.querySelector(`.settings-page[data-spage="${tab}"]`);
				if(target) target.classList.add("visible");
			});
		});
	})();

	// ── Add Server Modal ──
	let addServerModal = document.getElementById("addServerModal");
	let cancelServerBtn = document.getElementById("cancelServerBtn");
	let confirmServerBtn = document.getElementById("confirmServerBtn");
	let serverNameInput = document.getElementById("serverNameInput");
	let serverAddrInput = document.getElementById("serverAddrInput");

	if(cancelServerBtn && addServerModal) {
		cancelServerBtn.onclick = () => {
			addServerModal.classList.add("invisible");
		};
	}

	if(addServerModal) {
		addServerModal.addEventListener("keydown", (e) => {
			if(e.key === "Enter") confirmServerBtn && confirmServerBtn.click();
			if(e.key === "Escape") addServerModal.classList.add("invisible");
		});
		addServerModal.onclick = (e) => {
			if(e.target === addServerModal) addServerModal.classList.add("invisible");
		};
	}

	if(confirmServerBtn) {
		confirmServerBtn.onclick = () => {
			let name = serverNameInput.value.trim();
			let addr = serverAddrInput.value.trim();
			if(!addr) {
				serverAddrInput.focus();
				return;
			}
			if(!name) name = addr;
			if(!Array.isArray(Config.data.savedServers)) Config.data.savedServers = [];
			Config.data.savedServers.push({ name, addr });
			Config.save();
			addServerModal.classList.add("invisible");
			updateServers();
		};
	}


	let memory = document.querySelector(".memory");
	let memoryLabel = document.querySelector(".memory-label");

	if(memory && memoryLabel) {
		let totalMemMB = Math.floor(os.totalmem() / 1024 / 1024);
		memory.max = Math.min(totalMemMB, 16384);
		memory.min = 512;
		
		// Define o valor inicial da memória
		if(Config.data.maxMemory) {
			memory.value = Config.data.maxMemory;
		}

		function updateMemoryLabel() {
			memoryLabel.innerText = (memory.value / 1024).toFixed(1) + " GB";
			Config.data.maxMemory = parseInt(memory.value);
		}

		// Atualiza o label inicialmente
		updateMemoryLabel();
		
		memory.oninput = updateMemoryLabel;
		memory.onchange = () => {
			updateMemoryLabel();
			Config.save();
		};

		let closeOnLaunch = document.querySelector(".close-on-launch");
		if(closeOnLaunch) {
			closeOnLaunch.checked = Config.data.closeOnLaunch;
			closeOnLaunch.onchange = () => {
				Config.data.closeOnLaunch = closeOnLaunch.checked;
				Config.save();
			};
		}

		let optifine = document.querySelector(".optifine");
		if(optifine) {
			optifine.checked = Config.data.optifine;
			optifine.onchange = () => {
				Config.data.optifine = optifine.checked;
				Config.save();
			};
		}

		let autoUpdate = document.querySelector(".auto-update");
		if(autoUpdate) {
			autoUpdate.checked = Config.data.autoUpdate;
			autoUpdate.onchange = () => {
				Config.data.autoUpdate = autoUpdate.checked;
				Config.save();
			};
		}

		let jvmArguments = document.querySelector(".jvm-arguments");
		if(jvmArguments) {
			jvmArguments.value = Config.data.jvmArgs;
			jvmArguments.oninput = () => {
				Config.data.jvmArgs = jvmArguments.value;
			};
			jvmArguments.onchange = () => {
				Config.data.jvmArgs = jvmArguments.value;
				Config.save();
			};
		}
	}

	let currentTab = "about";

	function switchToTab(tab) {
		// Hide current tab
		let currentElement = document.querySelector("." + currentTab);
		if(currentElement) {
			currentElement.classList.add("invisible");
		}

		// Remove selected-tab from all tab buttons
		let allTabButtons = document.querySelectorAll(".tab-item");
		allTabButtons.forEach(btn => btn.classList.remove("selected-tab"));
		
		// Show new tab
		let newElement = document.querySelector("." + tab);
		if(newElement) {
			newElement.classList.remove("invisible");
		}
		
		// Add selected-tab to the correct button
		let tabBtnClass = tab === "settings" ? "settings-tab-btn"
			: tab === "accounts-panel" ? "accounts-tab-btn"
			: tab === "coins-panel" ? "coins-tab"
			: tab + "-tab";
		let tabBtn = document.querySelector("." + tabBtnClass);
		if(tabBtn) {
			tabBtn.classList.add("selected-tab");
		}

		currentTab = tab;
	}

	window.switchToTab = switchToTab;

	// ── Tab button handlers ──
	let aboutTabBtn = document.querySelector(".about-tab");
	if(aboutTabBtn) aboutTabBtn.onclick = () => switchToTab("about");

	let modsTabBtn = document.querySelector(".mods-tab");
	if(modsTabBtn) modsTabBtn.onclick = () => switchToTab("mods");

	let accountsTabBtn = document.querySelector(".accounts-tab-btn");
	if(accountsTabBtn) accountsTabBtn.onclick = () => switchToTab("accounts-panel");

	let newsTabBtn = document.querySelector(".news-tab");
	if(newsTabBtn) newsTabBtn.onclick = () => switchToTab("news");

	let coinsTabBtn = document.querySelector(".coins-tab");
	if(coinsTabBtn) coinsTabBtn.onclick = async () => {
		switchToTab("coins-panel");
		await initCoinsPanel();
	};

	let settingsTabBtn = document.querySelector(".settings-tab-btn");
	if(settingsTabBtn) settingsTabBtn.onclick = () => switchToTab("settings");

	for(let element of document.querySelectorAll(".open-in-browser")) {
		const href = element.href;
		element.href = "javascript:void(0);";
		element.onclick = function(event) {
			shell.openExternal(href);
		};
	}

	// ── COINS PANEL ──────────────────────────────────────
	let coinsInitialized = false;
	let _oauthPollTimer = null;
	let _oauthPollNick  = null;

	async function initCoinsPanel() {
		if(!coinsInitialized) {
			coinsInitialized = true;
			setupCoinsPanelListeners();
		}
		await refreshCoinsUI();
	}

	function _getActiveNick() {
		return launcher.accountManager && launcher.accountManager.activeAccount
			? launcher.accountManager.activeAccount.username
			: null;
	}

	function setupCoinsPanelListeners() {
		const linkHint = document.getElementById("coinsLinkHint");

		// ── Botão OAuth Discord ──
		const oauthBtn = document.getElementById("coinsDiscordOAuthBtn");
		if(oauthBtn) {
			oauthBtn.onclick = async () => {
				const account = launcher.accountManager.activeAccount;
				if(!account || !account.nick) {
					setHint(linkHint, "Selecione uma conta Minecraft primeiro.", "error");
					return;
				}
				oauthBtn.disabled = true;
				oauthBtn.innerHTML = '<span style="opacity:0.6">Abrindo Discord…</span>';
				setHint(linkHint, "", "info");
				try {
					const result = await Coins.getDiscordAuthUrl(account.nick);
					const url = result && (result.url || result.authUrl || result.redirect);
					if(!url) {
						setHint(linkHint, "Erro ao obter URL de autenticação (" + (result.error || "resposta vazia") + ").", "error");
						oauthBtn.disabled = false;
						oauthBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg> Conectar com Discord`;
						return;
					}
					setHint(linkHint, "Autorize o Discord no navegador…", "info");
					_showOAuthWaiting(true);
					const { shell } = require("electron");
					shell.openExternal(url);
					_startOAuthPolling(account.nick);
				} catch(err) {
					setHint(linkHint, "Erro: " + (err.message || "falha na requisição"), "error");
					oauthBtn.disabled = false;
					oauthBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg> Conectar com Discord`;
				}
			};
		}

		// ── Cancelar OAuth ──
		const cancelBtn = document.getElementById("coinsCancelAuthBtn");
		if(cancelBtn) {
			cancelBtn.onclick = () => {
				_stopOAuthPolling();
				_showOAuthWaiting(false);
				const oauthBtn2 = document.getElementById("coinsDiscordOAuthBtn");
				if(oauthBtn2) {
					oauthBtn2.disabled = false;
					oauthBtn2.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg> Conectar com Discord`;
				}
			};
		}

		// ── Desvincular ──
		const unlinkBtn = document.getElementById("unlinkDiscordBtn");
		if(unlinkBtn) {
			unlinkBtn.onclick = async () => {
				if(!confirm("Desvincular sua conta do Discord?")) return;
				const account = launcher.accountManager.activeAccount;
				if(!account || !account.nick) return;
				try {
					await Coins.unlinkDiscord(account.nick);
					Coins.removeDiscordLink();
					await refreshCoinsUI();
				} catch(err) {
					setHint(linkHint, "Erro ao desvincular: " + (err.message || err), "error");
				}
			};
		}

		// ── Atualizar saldo ──
		const refreshBtn = document.getElementById("coinsRefreshBtn");
		if(refreshBtn) {
			refreshBtn.onclick = async () => {
				const account = launcher.accountManager.activeAccount;
				if(!account || !account.nick) return;
				refreshBtn.disabled = true;
				refreshBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;display:inline-block"></span>';
				try {
					// Tenta re-verificar o status de vinculação
					const status = await Coins.checkAuthStatus(account.nick);
					const vinculado = status && (status.vinculado || status.linked || status.success);
					if(!vinculado) {
						const savedId = Coins.getSavedDiscordId();
						if(!savedId) {
							setHint(linkHint, "Conta não vinculada ao Discord.", "error");
							refreshBtn.disabled = false;
							refreshBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
							return;
						}
					}
					await refreshCoinsUI();
					await loadBalance();
					setHint(linkHint, "Saldo atualizado!", "ok");
				} catch(err) {
					setHint(linkHint, "Erro ao atualizar: " + (err.message || err), "error");
				}
				refreshBtn.disabled = false;
				refreshBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
			};
		}

		// ── Resgatar código ──
		const redeemSection = document.querySelector(".coins-redeem-section");
		if(redeemSection) redeemSection.style.display = "";
		const redeemBtn = document.getElementById("redeemCodeBtn");
		const redeemInput = document.getElementById("redeemCodeInput");
		const redeemResult = document.getElementById("coinsRedeemResult");
		if(redeemBtn && redeemInput) {
			redeemBtn.onclick = async () => {
				const code = redeemInput.value.trim();
				if(!code) {
					if(redeemResult) { redeemResult.textContent = "Digite um código."; }
					return;
				}
				redeemBtn.disabled = true;
				redeemBtn.textContent = "…";
				if(redeemResult) redeemResult.textContent = "Resgatando...";
				try {
					const result = await Coins.resgatarCodigo(code);
					if(redeemResult) redeemResult.textContent = result.message || result.msg || "✓ Código resgatado!";
					redeemInput.value = "";
					await loadBalance();
				} catch(err) {
					if(redeemResult) redeemResult.textContent = "Erro: " + (err.message || err);
				}
				redeemBtn.disabled = false;
				redeemBtn.textContent = "Resgatar";
			};
		}

		// ── Consultar por nick ──
		const nickSection = document.querySelector(".coins-nick-section");
		if(nickSection) nickSection.style.display = "";
		const nickBtn = document.getElementById("nickQueryBtn");
		const nickInput = document.getElementById("nickQueryInput");
		const nickResult = document.getElementById("coinsNickResult");
		if(nickBtn && nickInput && nickResult) {
			nickBtn.onclick = async () => {
				const target = nickInput.value.trim();
				if(!target) { nickResult.textContent = "Digite um nick."; return; }
				nickBtn.disabled = true;
				nickBtn.textContent = "…";
				try {
					const data = await Coins.fetchSaldoByNick(target);
					const saldo = data.saldo ?? data.coins ?? data.balance ?? "?";
					nickResult.textContent = `${target}: ${saldo} moedas`;
				} catch(err) {
					nickResult.textContent = "Erro: " + (err.message || err);
				}
				nickBtn.disabled = false;
				nickBtn.textContent = "Consultar";
			};
		}
	}

	function _showOAuthWaiting(waiting) {
		const readyEl   = document.getElementById("coinsReadyToLink");
		const waitingEl = document.getElementById("coinsWaitingAuth");
		if(readyEl)   readyEl.style.display   = waiting ? "none" : "";
		if(waitingEl) waitingEl.style.display  = waiting ? "" : "none";
	}

	function _startOAuthPolling(nick) {
		_stopOAuthPolling();
		_oauthPollNick = nick;
		let attempts = 0;
		const MAX_ATTEMPTS = 60;

		_oauthPollTimer = setInterval(async() => {
			attempts++;
			if(attempts > MAX_ATTEMPTS) {
				_stopOAuthPolling();
				_showOAuthWaiting(false);
				const oauthBtn = document.getElementById("coinsDiscordOAuthBtn");
				if(oauthBtn) oauthBtn.disabled = false;
				setHint(document.getElementById("coinsLinkHint"), "Tempo esgotado. Tente novamente.", "error");
				return;
			}

			try {
				const status = await Coins.checkAuthStatus(nick);
				// Aceita diferentes nomes de campo da API
				const vinculado = status && (
					status.vinculado || status.linked || status.success || status.ok || status.status === "linked"
				);
				const discordId = status && (
					status.discord_id || status.discordId || status.discordID || status.id
				);
				if(vinculado && discordId) {
					_stopOAuthPolling();
					Coins.saveDiscordId(discordId);
					const username = status.username || status.discord_username || status.discordName || null;
					const avatar = status.avatar || status.discord_avatar || null;
					if(username || avatar) {
						Coins.saveDiscordUser(discordId, username, avatar);
					}
					// Persiste no Firebase
					const account = launcher.accountManager.activeAccount;
					if(account && account.uuid) {
						Coins.saveDiscordLinkToFirebase(account.uuid, discordId, username, avatar).catch(() => {});
					}
					await refreshCoinsUI();
					updateHomeBalance();
				} else if(status && Object.keys(status).length > 0) {
					const msg = "[Coins] Status da vinculação: " + JSON.stringify(status);
					console.log(msg);
					ipcRenderer.send("log", "info", msg);
				}
			} catch(err) {
				const msg = "[Coins] Erro no polling: " + (err && err.message ? err.message : JSON.stringify(err));
				console.error(msg);
				ipcRenderer.send("log", "error", msg);
			}
		}, 3000);
	}

	function _stopOAuthPolling() {
		if(_oauthPollTimer) {
			clearInterval(_oauthPollTimer);
			_oauthPollTimer = null;
		}
		_oauthPollNick = null;
	}

	async function refreshCoinsUI() {
		_stopOAuthPolling();
		_showOAuthWaiting(false);

		const linkSection    = document.getElementById("coinsLinkSection");
		const balanceSection = document.getElementById("coinsBalanceSection");
		const noAccEl = document.getElementById("coinsNoAccount");
		const readyEl = document.getElementById("coinsReadyToLink");

		if(linkSection) linkSection.style.display = "";

		const account = launcher.accountManager.activeAccount;
		if(!account) {
			if(noAccEl) {
				noAccEl.style.display = "";
				noAccEl.innerHTML = `
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
					Faça login com uma conta Minecraft primeiro.
				`;
			}
			if(readyEl) readyEl.style.display = "none";
		} else {
			if(noAccEl) noAccEl.style.display = "none";
			if(readyEl) readyEl.style.display = "";
			// Atualiza nick exibido
			const oauthNick = document.getElementById("coinsOAuthNick");
			if(oauthNick) oauthNick.textContent = account.username;
		}
		if(balanceSection) balanceSection.style.display = "none";
	}

	async function loadBalance() {
		let savedId = Coins.getSavedDiscordId();
		// Tenta carregar do Firebase se não tiver local
		if(!savedId) {
			const account = launcher.accountManager.activeAccount;
			if(account && account.uuid) {
				try {
					const fb = await Coins.getDiscordLinkFromFirebase(account.uuid);
					if(fb && fb.discordId) {
						savedId = fb.discordId;
						Coins.saveDiscordUser(fb.discordId, fb.username, fb.avatar);
					}
				} catch(_) {}
			}
		}
		if(!savedId) return;

		const amountEl  = document.getElementById("coinsBalanceAmount");
		const discordEl = document.getElementById("coinsBalanceDiscord");
		const statsGrid = document.getElementById("coinsStatsGrid");

		if(amountEl) amountEl.innerHTML = '<div class="spinner"></div>';
		if(statsGrid) statsGrid.innerHTML = "";

		try {
			const data = await Coins.fetchStatsByDiscordId(savedId);
			const saldo = data.saldo ?? data.coins ?? data.balance ?? data.amount ?? "?";

			if(amountEl) {
				amountEl.innerHTML = `
					<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f0c040" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
						<circle cx="12" cy="12" r="9"/>
						<path d="M14.5 9a3 3 0 0 0-5 2.2c0 2.4 5 3.8 5 6a3 3 0 0 1-5 .8"/>
						<line x1="12" y1="6" x2="12" y2="8"/>
						<line x1="12" y1="16" x2="12" y2="18"/>
					</svg>
					${saldo}`;
			}

			const saved = Coins.getSavedDiscordUser();
			if(discordEl) {
				discordEl.textContent = saved && saved.username
					? "@" + saved.username
					: "ID: " + savedId;
			}

			if(statsGrid) {
				const skip = new Set(["saldo","coins","balance","amount","discord_id","discordId","id"]);
				const extras = Object.entries(data).filter(([k]) => !skip.has(k));
				if(extras.length > 0) {
					statsGrid.innerHTML = extras.map(([k, v]) => `
						<div class="coins-stat-card">
							<div class="coins-stat-label">${xss(k.replace(/_/g," "))}</div>
							<div class="coins-stat-value">${xss(String(v))}</div>
						</div>`).join("");
				}
			}

			// Atualiza o saldo na home também
			updateHomeBalance();
		} catch(err) {
			if(amountEl) amountEl.innerHTML = '<span style="font-size:0.5em; color:var(--w40);">Erro ao carregar</span>';
			if(discordEl) discordEl.textContent = "";
		}
	}

	// ── ATUALIZAR SALDO NA HOME ──
	async function updateHomeBalance() {
		const homeBalanceEl = document.getElementById("homeCoinsBalance");
		if(!homeBalanceEl) return;
		homeBalanceEl.style.display = "none";
	}

	// Carrega o saldo na home quando o launcher inicia
	updateHomeBalance();

	function setHint(el, msg, type) {
		if(!el) return;
		el.textContent = msg;
		el.className = "coins-link-hint";
		if(type === "error") el.classList.add("coins-hint-error");
		else if(type === "ok")   el.classList.add("coins-hint-ok");
		else if(type === "info") el.classList.add("coins-hint-info");
	}
	// ── Sidebar collapse toggle ──
	{
		const sidebar = document.getElementById("sidebar");
		const btn = document.getElementById("sidebarCollapseBtn");
		const logo = document.getElementById("sidebarLogo");
		if(sidebar && btn) {
			btn.onclick = () => {
				const isCollapsed = sidebar.classList.toggle("collapsed");
				if(logo) {
					logo.src = isCollapsed ? "assets/logo2.png" : "assets/logo.png";
					logo.onerror = () => { logo.src = "assets/logo.png"; };
				}
				btn.title = isCollapsed ? "Mostrar mais" : "Mostrar menos";
			};
		}
	}
	// ────────────────────────────────────────────────────

});
