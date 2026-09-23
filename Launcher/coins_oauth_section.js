	// ── COINS PANEL ──────────────────────────────────────
	let coinsInitialized = false;
	let _oauthPollTimer = null;
	let _oauthPollNick  = null;

	function initCoinsPanel() {
		if(!coinsInitialized) {
			coinsInitialized = true;
			setupCoinsPanelListeners();
		}
		refreshCoinsUI();
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
			oauthBtn.onclick = async() => {
				const nick = _getActiveNick();
				if(!nick) {
					setHint(linkHint, "Nenhuma conta Minecraft ativa.", "error");
					return;
				}

				oauthBtn.disabled = true;
				oauthBtn.textContent = "...";
				setHint(linkHint, "", "");

				try {
					const res = await Coins.getDiscordAuthUrl(nick);
					if(!res || !res.url) throw new Error("URL não retornada");

					shell.openExternal(res.url);
					_showOAuthWaiting(true);
					_startOAuthPolling(nick);
				} catch(err) {
					setHint(linkHint, "Não foi possível conectar à API. Tente novamente.", "error");
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
			unlinkBtn.onclick = () => {
				Coins.clearDiscordId();
				refreshCoinsUI();
			};
		}

		// ── Atualizar saldo ──
		const refreshBtn = document.getElementById("coinsRefreshBtn");
		if(refreshBtn) {
			refreshBtn.onclick = () => loadBalance();
		}

		// ── Resgatar código ──
		const redeemBtn   = document.getElementById("redeemCodeBtn");
		const redeemInput = document.getElementById("redeemCodeInput");
		const redeemResult = document.getElementById("coinsRedeemResult");

		if(redeemBtn && redeemInput) {
			redeemInput.addEventListener("keydown", (e) => { if(e.key === "Enter") redeemBtn.click(); });
			redeemInput.addEventListener("input",   () => { redeemInput.value = redeemInput.value.toUpperCase(); });

			redeemBtn.onclick = async() => {
				const code = redeemInput.value.trim();
				if(!code) { setHint(redeemResult, "Digite um código.", "error"); return; }
				redeemBtn.disabled = true;
				redeemBtn.textContent = "...";
				setHint(redeemResult, "Resgatando...", "info");
				try {
					const data = await Coins.resgatarCodigo(code);
					const msg = data.message || data.msg || "Código resgatado com sucesso!";
					setHint(redeemResult, "✓ " + msg, "ok");
					redeemInput.value = "";
					setTimeout(() => loadBalance(), 800);
				} catch(err) {
					let msg = "Erro ao resgatar o código.";
					if(err && err.status === 404) msg = "Código não encontrado ou já utilizado.";
					else if(err && err.status === 400) msg = "Código inválido.";
					setHint(redeemResult, msg, "error");
				} finally {
					redeemBtn.disabled = false;
					redeemBtn.textContent = "Resgatar";
				}
			};
		}

		// ── Consultar por nick ──
		const nickBtn    = document.getElementById("nickQueryBtn");
		const nickInput  = document.getElementById("nickQueryInput");
		const nickResult = document.getElementById("coinsNickResult");

		if(nickBtn && nickInput) {
			nickInput.addEventListener("keydown", (e) => { if(e.key === "Enter") nickBtn.click(); });

			nickBtn.onclick = async() => {
				const nick = nickInput.value.trim();
				if(!nick) { nickResult.innerHTML = ""; setHint(nickResult, "Digite um nick.", "error"); return; }
				nickBtn.disabled = true;
				nickBtn.textContent = "...";
				nickResult.innerHTML = '<span class="coins-hint-info" style="font-size:0.74em;">Buscando...</span>';
				try {
					const data = await Coins.fetchSaldoByNick(nick);
					const saldo = data.saldo ?? data.coins ?? data.balance ?? data.amount ?? JSON.stringify(data);
					nickResult.innerHTML = `
						<div class="coins-nick-result-card">
							<span class="coins-nick-result-name">${xss(nick)}</span>
							<span class="coins-nick-result-amount">🪙 ${saldo}</span>
						</div>`;
				} catch(err) {
					const msg = err && err.status === 404 ? "Jogador não encontrado." : "Erro ao consultar. Tente novamente.";
					nickResult.innerHTML = `<span class="coins-hint-error" style="font-size:0.74em;">${msg}</span>`;
				} finally {
					nickBtn.disabled = false;
					nickBtn.textContent = "Consultar";
				}
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
				if(status && status.vinculado && status.discord_id) {
					_stopOAuthPolling();
					Coins.saveDiscordId(status.discord_id);
					refreshCoinsUI();
				}
			} catch(_) {}
		}, 3000);
	}

	function _stopOAuthPolling() {
		if(_oauthPollTimer) {
			clearInterval(_oauthPollTimer);
			_oauthPollTimer = null;
		}
		_oauthPollNick = null;
	}

	function refreshCoinsUI() {
		_stopOAuthPolling();
		_showOAuthWaiting(false);

		const savedId   = Coins.getSavedDiscordId();
		const linkSection    = document.getElementById("coinsLinkSection");
		const balanceSection = document.getElementById("coinsBalanceSection");

		const nickEl = document.getElementById("coinsOAuthNick");
		const noAccEl = document.getElementById("coinsNoAccount");
		const readyEl = document.getElementById("coinsReadyToLink");
		const nick = _getActiveNick();

		if(nickEl) nickEl.textContent = nick || "—";
		if(noAccEl) noAccEl.style.display = nick ? "none" : "";
		if(readyEl) readyEl.style.display = nick ? "" : "none";

		if(!savedId) {
			if(linkSection)    linkSection.style.display    = "";
			if(balanceSection) balanceSection.style.display = "none";
		} else {
			if(linkSection)    linkSection.style.display    = "none";
			if(balanceSection) balanceSection.style.display = "";
			loadBalance();
		}
	}

	async function loadBalance() {
		const savedId = Coins.getSavedDiscordId();
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
		} catch(err) {
			if(amountEl) amountEl.innerHTML = '<span style="font-size:0.5em; color:var(--w40);">Erro ao carregar</span>';
			if(discordEl) discordEl.textContent = "";
		}
	}

	function setHint(el, msg, type) {
		if(!el) return;
		el.textContent = msg;
		el.className = "coins-link-hint";
		if(type === "error") el.classList.add("coins-hint-error");
		else if(type === "ok")   el.classList.add("coins-hint-ok");
		else if(type === "info") el.classList.add("coins-hint-info");
	}
	// ────────────────────────────────────────────────────

});
