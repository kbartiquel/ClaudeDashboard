const os = require('os');
const path = require('path');
const fs = require('fs');

// Track active sessions: id -> { pty, projectPath, sessionId, createdAt }
const activeSessions = new Map();

// Track sessions that were running when app closed (for resume)
const SESSION_STATE_FILE = path.join(__dirname, '..', '.terminal-sessions.json');

let ptyModule = null;
function getPty() {
  if (!ptyModule) {
    ptyModule = require('node-pty');
  }
  return ptyModule;
}

/**
 * Build a full PATH that includes common CLI install locations.
 * Packaged Electron .app only gets /usr/bin:/bin:/usr/sbin:/sbin.
 */
function getShellEnv() {
  const home = os.homedir();
  const extraPaths = [
    path.join(home, '.local', 'bin'),        // claude CLI lives here
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    path.join(home, '.nvm', 'versions', 'node', 'current', 'bin'),
    path.join(home, '.npm-global', 'bin'),
  ];
  const currentPath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  const combined = [...extraPaths, ...currentPath.split(':')];
  // dedupe while preserving order
  const unique = [...new Set(combined)];
  const env = { ...process.env, PATH: unique.join(':'), TERM: 'xterm-256color' };
  // Remove CLAUDECODE env var so spawned claude doesn't think it's nested
  delete env.CLAUDECODE;
  return env;
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Save active session IDs so they can be resumed on next launch
 */
function saveSessionState() {
  const state = [];
  for (const [id, session] of activeSessions) {
    state.push({
      id,
      projectPath: session.projectPath,
      claudeSessionId: session.claudeSessionId || null,
      createdAt: session.createdAt,
    });
  }
  try {
    fs.writeFileSync(SESSION_STATE_FILE, JSON.stringify(state, null, 2));
  } catch { /* ignore */ }
}

/**
 * Load previous session state for resume
 */
function loadSessionState() {
  try {
    if (fs.existsSync(SESSION_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_STATE_FILE, 'utf-8'));
      // Clear the file after loading
      fs.unlinkSync(SESSION_STATE_FILE);
      return data;
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Create a new terminal session with WebSocket bridge
 */
function createSession(ws, projectPath, resumeSessionId = null) {
  const pty = getPty();
  const id = generateId();

  const args = ['--dangerously-skip-permissions'];
  if (resumeSessionId) {
    args.unshift('--resume', resumeSessionId);
  }

  const ptyProcess = pty.spawn('claude', args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: projectPath || os.homedir(),
    env: getShellEnv(),
  });

  const session = {
    pty: ptyProcess,
    projectPath,
    claudeSessionId: resumeSessionId || null,
    createdAt: new Date().toISOString(),
    ws,
  };

  activeSessions.set(id, session);

  // Detect Claude session ID for new sessions
  if (resumeSessionId) {
    // Already known — send immediately
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'session-id', sessionId: resumeSessionId }));
    }
  } else {
    // New session — scan for newest .jsonl file after Claude starts
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    setTimeout(() => {
      try {
        // Find matching project dir by checking which encoded dir matches this projectPath
        const dirs = fs.readdirSync(claudeProjectsDir).filter(d =>
          fs.statSync(path.join(claudeProjectsDir, d)).isDirectory()
        );
        for (const dir of dirs) {
          const dirPath = path.join(claudeProjectsDir, dir);
          const jsonlFiles = fs.readdirSync(dirPath)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dirPath, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          if (jsonlFiles.length > 0) {
            const newest = jsonlFiles[0];
            // Check if this file was just created (within last 10s)
            if (Date.now() - newest.mtime < 10000) {
              const detectedId = newest.name.replace('.jsonl', '');
              session.claudeSessionId = detectedId;
              saveSessionState();
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'session-id', sessionId: detectedId }));
              }
              break;
            }
          }
        }
      } catch { /* ignore */ }
    }, 3000);
  }

  // Pipe pty output to WebSocket
  ptyProcess.onData((data) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    activeSessions.delete(id);
    saveSessionState();
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
  });

  // Handle incoming data from WebSocket
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize') {
        ptyProcess.resize(msg.cols, msg.rows);
      } else if (msg.type === 'kill') {
        ptyProcess.kill();
        activeSessions.delete(id);
        saveSessionState();
      }
    } catch { /* ignore bad messages */ }
  });

  ws.on('close', () => {
    // Don't kill the pty when WS disconnects — track for resume
    // The pty will die on its own or be killed on app quit
    saveSessionState();
  });

  saveSessionState();

  return { id, projectPath };
}

/**
 * Create a terminal session for auth switching (logout + login)
 */
function createAuthSession(ws) {
  const pty = getPty();

  const ptyProcess = pty.spawn('/bin/zsh', ['-c', 'claude auth logout && claude auth login'], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: os.homedir(),
    env: getShellEnv(),
  });

  ptyProcess.onData((data) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize') {
        ptyProcess.resize(msg.cols, msg.rows);
      } else if (msg.type === 'kill') {
        ptyProcess.kill();
      }
    } catch { /* ignore */ }
  });

  ws.on('close', () => {
    try { ptyProcess.kill(); } catch { /* ignore */ }
  });
}

/**
 * Kill a specific session
 */
function killSession(id) {
  const session = activeSessions.get(id);
  if (session) {
    session.pty.kill();
    activeSessions.delete(id);
    saveSessionState();
    return true;
  }
  return false;
}

/**
 * Kill all active sessions (called on app quit)
 */
function killAll() {
  for (const [id, session] of activeSessions) {
    try {
      session.pty.kill();
    } catch { /* ignore */ }
  }
  activeSessions.clear();
}

/**
 * Get resumable sessions from previous launch
 */
function getResumableSessions() {
  return loadSessionState();
}

/**
 * List active sessions
 */
function listSessions() {
  const list = [];
  for (const [id, session] of activeSessions) {
    list.push({
      id,
      projectPath: session.projectPath,
      claudeSessionId: session.claudeSessionId,
      createdAt: session.createdAt,
    });
  }
  return list;
}

module.exports = {
  createSession,
  createAuthSession,
  killSession,
  killAll,
  listSessions,
  getResumableSessions,
  getShellEnv,
};
