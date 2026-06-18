const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { createServer } = require('./backend/server');
const terminal = require('./backend/terminal');
const config = require('./backend/config');

// Wrap a string in single quotes, safe for a POSIX shell.
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// Escape a string for embedding inside an AppleScript double-quoted literal.
function escapeAppleScript(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

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

ipcMain.handle('open-external-terminal', async (event, cwd, resumeSessionId, promptMode) => {
  const { execFile } = require('child_process');
  // Strip Claude env vars so the external terminal doesn't detect a nested session
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDECODE;
  delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
  delete cleanEnv.CLAUDE_CODE_SESSION;
  Object.keys(cleanEnv).forEach(k => {
    if (k.startsWith('CLAUDE_') || k.startsWith('CLAUDECODE')) delete cleanEnv[k];
  });
  const execOpts = { env: cleanEnv };

  if (resumeSessionId) {
    // Session IDs are UUID-like; reject anything else so it can't be used
    // to inject extra shell/AppleScript.
    if (!/^[A-Za-z0-9-]+$/.test(resumeSessionId)) {
      throw new Error('Invalid session id');
    }
    let claudeCmd = `claude --resume ${resumeSessionId} --dangerously-skip-permissions`;
    const promptFile = config.load().appendSystemPromptFile;
    if (promptFile && fs.existsSync(promptFile)) {
      if (promptMode === 'replace') {
        claudeCmd += ` --system-prompt-file ${shellQuote(promptFile)}`;
      } else if (promptMode === 'fable' || promptMode == null) {
        claudeCmd += ` --append-system-prompt-file ${shellQuote(promptFile)}`;
      }
    }
    const shellCmd = `cd ${shellQuote(cwd)} && ${claudeCmd}`;
    const appleScript = `tell app "Terminal" to do script "${escapeAppleScript(shellCmd)}"`;
    // execFile (no shell) + AppleScript escaping keeps cwd from breaking out.
    execFile('osascript', ['-e', appleScript, '-e', 'tell app "Terminal" to activate'], execOpts);
  } else {
    execFile('open', ['-a', 'Terminal', cwd], execOpts);
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

ipcMain.handle('pick-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select System Prompt File',
    filters: [{ name: 'Text', extensions: ['md', 'txt'] }, { name: 'All Files', extensions: ['*'] }],
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
