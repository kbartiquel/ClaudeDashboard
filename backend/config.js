const fs = require('fs');
const path = require('path');
const os = require('os');

// Store config in ~/.claude-dashboard/ (works for any user)
const CONFIG_DIR = path.join(os.homedir(), '.claude-dashboard');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const NAMES_PATH = path.join(CONFIG_DIR, 'conversation-names.json');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

const DEFAULTS = {
  scanDirectories: [],
  claudeProjectsDir: path.join(os.homedir(), '.claude', 'projects'),
  claudeHistoryFile: path.join(os.homedir(), '.claude', 'history.jsonl'),
  theme: 'dark',
  anthropicApiKey: '',
};

function load() {
  ensureDir();
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const saved = JSON.parse(raw);
      // Always resolve these from current user's home (never hardcode)
      saved.claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
      saved.claudeHistoryFile = path.join(os.homedir(), '.claude', 'history.jsonl');
      return { ...DEFAULTS, ...saved };
    }
  } catch (e) {
    console.error('Failed to load config:', e.message);
  }
  // First launch — auto-detect scan directories from Claude projects
  const autoConfig = { ...DEFAULTS };
  autoConfig.scanDirectories = autoDetectScanDirs();
  save(autoConfig);
  return autoConfig;
}

/**
 * On first launch, scan ~/.claude/projects/ and extract unique parent
 * directories where the user actually has code projects.
 */
function autoDetectScanDirs() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeDir)) return [];

  const parentDirs = new Set();
  const dirs = fs.readdirSync(claudeDir).filter(d => {
    return fs.statSync(path.join(claudeDir, d)).isDirectory();
  });

  for (const dir of dirs) {
    // Claude encodes paths as -Users-name-Documents-PROJECTS-Foo
    // Try to decode back to a real path
    const decoded = '/' + dir.replace(/^-/, '').replace(/-/g, '/');
    // Walk up to find the highest existing parent that contains projects
    const parts = decoded.split('/').filter(Boolean);
    for (let i = parts.length - 1; i >= 2; i--) {
      const candidate = '/' + parts.slice(0, i).join('/');
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        // Check this is a "projects container" (has subdirectories)
        const entries = fs.readdirSync(candidate).filter(e => {
          const ep = path.join(candidate, e);
          return fs.statSync(ep).isDirectory() && !e.startsWith('.');
        });
        if (entries.length > 0) {
          parentDirs.add(candidate);
          break;
        }
      }
    }
  }

  return [...parentDirs];
}

function save(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

function update(partial) {
  const current = load();
  const updated = { ...current, ...partial };
  save(updated);
  return updated;
}

// ---- Conversation Names ----

function loadNames() {
  ensureDir();
  try {
    if (fs.existsSync(NAMES_PATH)) {
      return JSON.parse(fs.readFileSync(NAMES_PATH, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveName(projectId, sessionId, name) {
  const names = loadNames();
  const key = `${projectId}/${sessionId}`;
  if (name) {
    names[key] = name;
  } else {
    delete names[key];
  }
  fs.writeFileSync(NAMES_PATH, JSON.stringify(names, null, 2), 'utf-8');
  return names;
}

function getName(projectId, sessionId) {
  const names = loadNames();
  return names[`${projectId}/${sessionId}`] || null;
}

module.exports = { load, save, update, CONFIG_PATH, loadNames, saveName, getName };
