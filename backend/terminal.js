const os = require('os');
const path = require('path');
const fs = require('fs');

// Track active sessions: id -> { pty, ws, projectPath, claudeSessionId, createdAt, outputBuffer, outputBufferSize }
const activeSessions = new Map();

// Track sessions that were running when app closed (for resume)
const SESSION_STATE_FILE = path.join(__dirname, '..', '.terminal-sessions.json');

// Max output buffer size per session (100KB)
const MAX_BUFFER_SIZE = 100 * 1024;

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
  const unique = [...new Set(combined)];
  const env = { ...process.env, PATH: unique.join(':'), TERM: 'xterm-256color' };
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
      fs.unlinkSync(SESSION_STATE_FILE);
      return data;
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Find an active session by project path
 */
function findSessionByPath(projectPath) {
  for (const [, session] of activeSessions) {
    if (session.projectPath === projectPath) return session;
  }
  return null;
}

/**
 * Push data into a session's output buffer, trimming oldest chunks if over limit
 */
function bufferOutput(session, data) {
  session.outputBuffer.push(data);
  session.outputBufferSize += data.length;
  while (session.outputBufferSize > MAX_BUFFER_SIZE && session.outputBuffer.length > 1) {
    const removed = session.outputBuffer.shift();
    session.outputBufferSize -= removed.length;
  }
}

/**
 * Wire input/close handlers from a WebSocket onto a session
 */
function attachWsHandlers(session, ws) {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'input') {
        session.pty.write(msg.data);
      } else if (msg.type === 'resize') {
        session.pty.resize(msg.cols, msg.rows);
      } else if (msg.type === 'kill') {
        session.pty.kill();
        activeSessions.delete(session.id);
        saveSessionState();
      }
    } catch { /* ignore bad messages */ }
  });

  ws.on('close', () => {
    // Detach ws but keep pty alive — session stays in activeSessions for reattach
    session.ws = null;
    saveSessionState();
  });
}

/**
 * Reattach a new WebSocket to an existing pty session.
 * Replays buffered output so the terminal is restored.
 */
function reattachSession(session, ws) {
  // Close old ws cleanly if still open
  if (session.ws && session.ws.readyState === 1 /* OPEN */) {
    session.ws.removeAllListeners('close');
    session.ws.removeAllListeners('message');
    session.ws.close();
  }

  session.ws = ws;

  // Replay buffered output so the terminal shows current state
  const buffered = session.outputBuffer.join('');
  if (buffered) {
    ws.send(JSON.stringify({ type: 'replay', data: buffered }));
  }

  attachWsHandlers(session, ws);
}

/**
 * Create a new terminal session with WebSocket bridge.
 * If a session for the same projectPath already exists, reattach to it.
 */
function createSession(ws, projectPath, resumeSessionId = null) {
  // Reattach if a live session exists for this path (and not a forced resume of a different session)
  if (!resumeSessionId) {
    const existing = findSessionByPath(projectPath);
    if (existing) {
      reattachSession(existing, ws);
      return { id: existing.id, projectPath, reattached: true };
    }
  }

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
    id,
    pty: ptyProcess,
    ws,
    projectPath,
    claudeSessionId: resumeSessionId || null,
    createdAt: new Date().toISOString(),
    outputBuffer: [],
    outputBufferSize: 0,
  };

  activeSessions.set(id, session);

  // Pipe pty output to WebSocket and into buffer
  ptyProcess.onData((data) => {
    bufferOutput(session, data);
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({ type: 'output', data }));
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    activeSessions.delete(id);
    saveSessionState();
    if (session.ws && session.ws.readyState === 1) {
      session.ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
    }
  });

  attachWsHandlers(session, ws);
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
  for (const [, session] of activeSessions) {
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
