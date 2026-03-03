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
  killSession,
  killAll,
  listSessions,
  getResumableSessions,
};
