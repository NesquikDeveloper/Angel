// friends.js — Sistema de amigos e chat via Firebase REST API
// Usa fetch nativo do Electron — sem SDK, compatível sem nodeIntegration

const DB_URL  = 'https://angel-client-cosmetics-default-rtdb.firebaseio.com';
const fs = require('fs');
const path = require('path');

// ── Constantes ──
const MAX_MESSAGES_PER_ROOM = 50;
const MSG_CLEANUP_THRESHOLD = 80;
const MSG_CLEANUP_KEEP      = 50;

// ── Estado local ──
let _myUuid     = null;
let _myUsername = null;
let _myHead     = null;
let _pollTimers = {};
let _chatCallback     = null;
let _chatRoomId       = null;
let _chatLastTs       = 0;
let _chatLastCount    = 0;
let _bgLastCounts     = {};
let _notificationCb   = null;
let _bgFriendsList    = [];
let _dataDir          = null;

// ── Cache local de mensagens ──
function init(dataDir) {
  _dataDir = dataDir;
}

function _chatCachePath(roomId) {
  const safe = roomId.replace(/[^a-zA-Z0-9_\-]/g, '_');
  return path.join(_dataDir, `chat_${safe}.json`);
}

function _loadLocalMessages(roomId) {
  if (!_dataDir) return null;
  try {
    const p = _chatCachePath(roomId);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {}
  return null;
}

function _saveLocalMessages(roomId, msgs) {
  if (!_dataDir) return;
  try {
    const toSave = msgs.slice(-100);
    fs.writeFileSync(_chatCachePath(roomId), JSON.stringify(toSave));
  } catch (_) {}
}

// ── Helpers HTTP ──
function safeKey(uuid) {
  return uuid.replace(/[.#$/[\]]/g, '_');
}

function chatRoomId(a, b) {
  const ka = safeKey(a), kb = safeKey(b);
  return ka < kb ? `${ka}__${kb}` : `${kb}__${ka}`;
}

function dbRequest(method, path, body) {
  return new Promise(resolve => {
    const url = `${DB_URL}${path}.json`;
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    fetch(url, { ...opts, signal: controller.signal })
      .then(async res => {
        clearTimeout(timer);
        if (!res.ok) { console.error('[Firebase] HTTP', res.status); resolve(null); return; }
        const text = await res.text();
        try { resolve(JSON.parse(text)); } catch { resolve(null); }
      })
      .catch(err => {
        clearTimeout(timer);
        console.error('[Firebase] fetch error:', err.message);
        resolve(null);
      });
  });
}

function dbGet(path)         { return dbRequest('GET',    path, null); }
function dbSet(path, body)   { return dbRequest('PUT',    path, body); }
function dbPatch(path, body) { return dbRequest('PATCH',  path, body); }
function dbDel(path)         { return dbRequest('DELETE', path, null); }
function dbPush(path, body)  { return dbRequest('POST',   path, body); }

// ════════════════════════════════════════
//  PRESENÇA
// ════════════════════════════════════════

async function goOnline(uuid, username, head) {
  _myUuid     = uuid;
  _myUsername = username;
  _myHead     = head || null;

  const uid = safeKey(uuid);

  await dbSet(`/users/${uid}`, { uuid, username, head: head || null });
  await dbSet(`/presence/${uid}`, { online: true, lastSeen: Date.now(), currentServer: null });

  if (_pollTimers._heartbeat) clearInterval(_pollTimers._heartbeat);
  _pollTimers._heartbeat = setInterval(async () => {
    await dbPatch(`/presence/${uid}`, { online: true, lastSeen: Date.now() });
  }, 30000);
}

async function setCurrentServer(server) {
  if (!_myUuid) return;
  const uid = safeKey(_myUuid);
  await dbPatch(`/presence/${uid}`, { currentServer: server || null });
}

async function goOffline() {
  if (!_myUuid) return;
  const uid = safeKey(_myUuid);
  await dbSet(`/presence/${uid}`, { online: false, lastSeen: Date.now(), currentServer: null });
  stopAllListeners();
  _myUuid = null;
}

// ════════════════════════════════════════
//  AMIGOS
// ════════════════════════════════════════

async function findUserByUsername(username) {
  const data = await dbGet('/users');
  if (!data) return null;
  const lower = username.toLowerCase();
  for (const uid of Object.keys(data)) {
    const u = data[uid];
    if (u.username && u.username.toLowerCase() === lower) return u;
  }
  return null;
}

async function sendFriendRequest(targetUuid) {
  if (!_myUuid) return { error: 'Não logado' };
  if (targetUuid === _myUuid) return { error: 'Você não pode se adicionar' };

  const myUid  = safeKey(_myUuid);
  const tgtUid = safeKey(targetUuid);

  const already = await dbGet(`/friends/${myUid}/${tgtUid}`);
  if (already) return { error: 'Já são amigos' };

  const pending = await dbGet(`/friendRequests/${tgtUid}/${myUid}`);
  if (pending) return { error: 'Pedido já enviado' };

  // Se o outro já me enviou pedido → aceita automaticamente
  const reverse = await dbGet(`/friendRequests/${myUid}/${tgtUid}`);
  if (reverse) {
    await acceptFriendRequest(targetUuid);
    return { ok: true, auto: true };
  }

  await dbSet(`/friendRequests/${tgtUid}/${myUid}`, {
    from: _myUuid,
    fromUsername: _myUsername,
    fromHead: _myHead || null,
    timestamp: Date.now()
  });
  return { ok: true };
}

async function acceptFriendRequest(fromUuid) {
  if (!_myUuid) return;
  const myUid   = safeKey(_myUuid);
  const fromUid = safeKey(fromUuid);
  await dbSet(`/friends/${myUid}/${fromUid}`, { uuid: fromUuid, since: Date.now() });
  await dbSet(`/friends/${fromUid}/${myUid}`, { uuid: _myUuid,  since: Date.now() });
  await dbDel(`/friendRequests/${myUid}/${fromUid}`);
}

async function declineFriendRequest(fromUuid) {
  if (!_myUuid) return;
  await dbDel(`/friendRequests/${safeKey(_myUuid)}/${safeKey(fromUuid)}`);
}

async function removeFriend(targetUuid) {
  if (!_myUuid) return;
  const myUid  = safeKey(_myUuid);
  const tgtUid = safeKey(targetUuid);
  await dbDel(`/friends/${myUid}/${tgtUid}`);
  await dbDel(`/friends/${tgtUid}/${myUid}`);
}

// Polling da lista de amigos a cada 10s
function listenFriends(callback) {
  if (!_myUuid) return;
  if (_pollTimers._friends) clearInterval(_pollTimers._friends);

  async function poll() {
    const myUid = safeKey(_myUuid);
    const data  = await dbGet(`/friends/${myUid}`);
    if (!data) { callback([]); _bgFriendsList = []; return; }

    const entries = await Promise.all(
      Object.values(data).map(async ({ uuid }) => {
        const uid  = safeKey(uuid);
        const user = await dbGet(`/users/${uid}`);
        const pres = await dbGet(`/presence/${uid}`);
        return {
          uuid,
          username: user ? user.username : uuid,
          head:     user ? user.head : null,
          online:   pres ? !!pres.online : false,
          server:   pres ? pres.currentServer || null : null
        };
      })
    );

    entries.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.username.localeCompare(b.username);
    });

    // Atualiza lista para polling de notificações em background
    _bgFriendsList = entries;

    callback(entries);
  }

  poll();
  _pollTimers._friends = setInterval(poll, 10000);

  // Inicia polling de notificações em background
  _startBgNotifications();
}

// Polling de pedidos recebidos a cada 15s
function listenIncomingRequests(callback) {
  if (!_myUuid) return;
  if (_pollTimers._requests) clearInterval(_pollTimers._requests);

  async function poll() {
    const myUid = safeKey(_myUuid);
    const data  = await dbGet(`/friendRequests/${myUid}`);
    if (!data) { callback([]); return; }
    const reqs = Object.values(data).map(v => ({
      fromUuid:     v.from,
      fromUsername: v.fromUsername,
      fromHead:     v.fromHead || null
    }));
    callback(reqs);
  }

  poll();
  _pollTimers._requests = setInterval(poll, 15000);
}

// ════════════════════════════════════════
//  CHAT
// ════════════════════════════════════════

// Apaga mensagens antigas quando a sala ultrapassa o limite
async function pruneMessages(roomId) {
  const data = await dbGet(`/chats/${roomId}/messages`);
  if (!data) return;
  const entries = Object.entries(data).map(([id, v]) => ({ id, ...v }));
  if (entries.length <= MSG_CLEANUP_THRESHOLD) return;

  // Ordena por timestamp e apaga as mais antigas
  entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const toDelete = entries.slice(0, entries.length - MSG_CLEANUP_KEEP);
  await Promise.all(toDelete.map(m => dbDel(`/chats/${roomId}/messages/${m.id}`)));
}

async function sendMessage(toUuid, text) {
  if (!_myUuid || !text.trim()) return;
  const roomId = chatRoomId(_myUuid, toUuid);
  const msg = {
    from:         _myUuid,
    fromUsername: _myUsername,
    text:         text.trim(),
    ts:           Date.now()
  };
  // Salva no Firebase
  await dbPush(`/chats/${roomId}/messages`, msg);
  // Salva local
  const local = _loadLocalMessages(roomId) || [];
  local.push(msg);
  _saveLocalMessages(roomId, local);
  pruneMessages(roomId).catch(() => {});
}

// Polling de mensagens da sala aberta a cada 2s
function listenChat(toUuid, callback) {
  stopListenChat();
  _chatRoomId    = chatRoomId(_myUuid, toUuid);
  _chatCallback  = callback;
  _chatLastTs    = 0;
  _chatLastCount = 0;

  // Carrega cache local primeiro
  const local = _loadLocalMessages(_chatRoomId);
  if (local && local.length > 0) callback(local);

  async function poll() {
    const data = await dbGet(`/chats/${_chatRoomId}/messages`);
    if (!data) { return; }
    const msgs = Object.entries(data)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    _chatLastCount = msgs.length;
    // Salva no cache local
    _saveLocalMessages(_chatRoomId, msgs);
    callback(msgs);
  }

  poll();
  _pollTimers._chat = setInterval(poll, 2000);
}

function stopListenChat() {
  if (_pollTimers._chat) { clearInterval(_pollTimers._chat); _pollTimers._chat = null; }
  _chatCallback  = null;
  _chatRoomId    = null;
  _chatLastCount = 0;
}

// Registra callback para notificações de mensagens em background
// callback(fromUsername, fromHead, text, friendUuid)
function onNewMessage(callback) {
  _notificationCb = callback;
}

// Polling de notificações em background (salas que não estão abertas)
function _startBgNotifications() {
  if (_pollTimers._bgNotif) clearInterval(_pollTimers._bgNotif);

  _pollTimers._bgNotif = setInterval(async () => {
    if (!_myUuid || !_notificationCb) return;

    for (const friend of _bgFriendsList) {
      const roomId = chatRoomId(_myUuid, friend.uuid);
      // Não notifica a sala que está aberta no momento
      if (roomId === _chatRoomId) continue;

      try {
        const data = await dbGet(`/chats/${roomId}/messages`);
        if (!data) { _bgLastCounts[roomId] = 0; continue; }

        const msgs = Object.entries(data)
          .map(([id, v]) => ({ id, ...v }))
          .sort((a, b) => (a.ts || 0) - (b.ts || 0));

        const prev = _bgLastCounts[roomId] ?? msgs.length; // Na primeira vez não notifica
        _bgLastCounts[roomId] = msgs.length;

        if (msgs.length > prev) {
          // Há mensagens novas — pega a última que não é minha
          const newMsgs = msgs.slice(prev);
          const incoming = newMsgs.filter(m => m.from !== _myUuid);
          if (incoming.length > 0) {
            const last = incoming[incoming.length - 1];
            _notificationCb(
              last.fromUsername || friend.username,
              friend.head || null,
              last.text,
              friend.uuid
            );
          }
        }
      } catch (_) {}
    }
  }, 5000); // Verifica a cada 5s
}

function stopAllListeners() {
  Object.keys(_pollTimers).forEach(k => {
    if (_pollTimers[k]) clearInterval(_pollTimers[k]);
  });
  _pollTimers = {};
  _bgFriendsList = [];
  _bgLastCounts  = {};
}

module.exports = {
  init,
  goOnline, goOffline, setCurrentServer,
  findUserByUsername,
  sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend,
  listenFriends, listenIncomingRequests,
  sendMessage, listenChat, stopListenChat, stopAllListeners,
  onNewMessage,
  getMyUuid:     () => _myUuid,
  getMyUsername: () => _myUsername,
  chatRoomId,
  dbGet
};
