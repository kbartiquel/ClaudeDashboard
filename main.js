const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const { createServer } = require('./backend/server');
const terminal = require('./backend/terminal');

let mainWindow;
let server;
let serverPort;

async function startServer() {
  return new Promise((resolve, reject) => {
    server = createServer();
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`Express server running on http://127.0.0.1:${serverPort}`);
      resolve(serverPort);
    });
    server.on('error', reject);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('open-external-terminal', async (event, cwd, resumeSessionId) => {
  const { exec } = require('child_process');
  if (resumeSessionId) {
    // Open Terminal.app and run claude --resume with the session ID
    const cmd = `cd "${cwd}" && claude --resume ${resumeSessionId} --dangerously-skip-permissions`;
    exec(`osascript -e 'tell app "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"' -e 'tell app "Terminal" to activate'`);
  } else {
    exec(`open -a Terminal "${cwd}"`);
  }
  return true;
});

ipcMain.handle('save-temp-file', async (event, arrayBuffer, mimeType, fileName) => {
  const fs = require('fs');
  const os = require('os');
  // Use original filename if available, otherwise derive from mime type
  let name;
  if (fileName) {
    name = `claude-drop-${Date.now()}-${fileName}`;
  } else {
    const extMap = {
      'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
      'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv',
      'application/json': '.json', 'text/html': '.html',
    };
    const ext = extMap[mimeType] || '.bin';
    name = `claude-drop-${Date.now()}${ext}`;
  }
  const tmpPath = path.join(os.tmpdir(), name);
  fs.writeFileSync(tmpPath, Buffer.from(arrayBuffer));
  return tmpPath;
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Project Directory',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

app.whenReady().then(async () => {
  await startServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  terminal.killAll();
  if (server) {
    server.close();
  }
});
