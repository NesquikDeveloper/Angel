// ── ADICIONE ISSO NO main.js ─────────────────────────────────────────
// Cole junto com o restante do código, onde você lança o processo do Minecraft

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let logWindow = null;

function openLogWindow() {
  if (logWindow) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 860,
    height: 520,
    minWidth: 600,
    minHeight: 300,
    title: 'Bosta Client — Console',
    frame: false,           // usa a titlebar customizada do log.html
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  logWindow.loadFile(path.join(__dirname, 'log.html'));

  logWindow.on('closed', () => {
    logWindow = null;
  });
}

// Chame openLogWindow() quando o Minecraft for lançado.
// Exemplo: onde você tem o spawn do processo do Minecraft, adicione:

// openLogWindow();
// logWindow.webContents.send('game-started');
//
// minecraftProcess.stdout.on('data', (data) => {
//   const lines = data.toString().split('\n').filter(l => l.trim());
//   lines.forEach(line => {
//     if (logWindow) logWindow.webContents.send('log-line', line);
//   });
// });
//
// minecraftProcess.stderr.on('data', (data) => {
//   const lines = data.toString().split('\n').filter(l => l.trim());
//   lines.forEach(line => {
//     if (logWindow) logWindow.webContents.send('log-line', line);
//   });
// });
//
// minecraftProcess.on('close', () => {
//   if (logWindow) logWindow.webContents.send('game-stopped');
// });
