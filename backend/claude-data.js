const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');

// Cache: projectDirName -> { cwd, name, dirName }
let projectCache = null;
let lastCacheTime = 0;
const CACHE_TTL = 30000; // 30s

function getClaudeProjectsDir() {
  return config.load().claudeProjectsDir;
}

/**
 * Parse a single JSONL line safely
 */
function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Read the first valid entry with cwd from a JSONL file.
 * Scans up to 500 lines (some files have many snapshot lines first).
 */
function readFirstEntry(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const limit = Math.min(lines.length, 500);
    for (let i = 0; i < limit; i++) {
      if (!lines[i].trim()) continue;
      const entry = parseLine(lines[i]);
      if (entry && entry.cwd) return entry;
    }
  } catch {
    // file read error
  }
  return null;
}

/**
 * Try all JSONL files in a directory to find a cwd.
 */
function findCwdInDir(dirPath, jsonlFiles) {
  for (const file of jsonlFiles) {
    const entry = readFirstEntry(path.join(dirPath, file));
    if (entry && entry.cwd) return entry.cwd;
  }
  return null;
}

/**
 * Smart decode of encoded dir name back to a real filesystem path.
 * Claude encodes paths by replacing both / and spaces with -.
 * e.g. "/Users/foo/Quiz Maker AI" → "-Users-foo-Quiz-Maker-AI"
 * We greedily match the longest existing path segment at each level,
 * trying both '-' (original dash) and ' ' (was a space) as joiners.
 */
function decodeDirName(dirName) {
  const parts = dirName.replace(/^-/, '').split('-');

  function resolve(idx, currentPath) {
    if (idx >= parts.length) return currentPath;

    // Try longest segment first (greedy)
    for (let j = parts.length; j > idx; j--) {
      // Try with dashes (original folder had dashes)
      const withDash = parts.slice(idx, j).join('-');
      const candDash = currentPath + '/' + withDash;
      if (fs.existsSync(candDash)) {
        const rest = resolve(j, candDash);
        if (rest) return rest;
      }

      // Try with spaces (folder had spaces, encoded as dashes)
      if (j - idx > 1) {
        const withSpace = parts.slice(idx, j).join(' ');
        const candSpace = currentPath + '/' + withSpace;
        if (fs.existsSync(candSpace)) {
          const rest = resolve(j, candSpace);
          if (rest) return rest;
        }
      }
    }

    // No existing path found — use single part as-is
    return resolve(idx + 1, currentPath + '/' + parts[idx]);
  }

  return resolve(0, '');
}

/**
 * Enumerate all projects from ~/.claude/projects/
 * Returns array of { dirName, cwd, name, conversationCount, lastActivity }
 */
function enumerateProjects(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && projectCache && (now - lastCacheTime) < CACHE_TTL) {
    return projectCache;
  }

  const projectsDir = getClaudeProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];

  const dirs = fs.readdirSync(projectsDir).filter(d => {
    const fullPath = path.join(projectsDir, d);
    return fs.statSync(fullPath).isDirectory();
  });

  const cfg = config.load();
  const scanDirs = cfg.scanDirectories || [];

  const projects = [];
  for (const dirName of dirs) {
    const dirPath = path.join(projectsDir, dirName);
    const jsonlFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) continue;

    // Try all JSONL files to find cwd, fallback to decoding dir name
    let cwd = findCwdInDir(dirPath, jsonlFiles);
    if (!cwd) {
      cwd = decodeDirName(dirName);
    }

    // Filter by scan directories
    if (scanDirs.length > 0) {
      const inScanDir = scanDirs.some(sd => cwd.startsWith(sd));
      if (!inScanDir) continue;
    }

    // Get last activity time from most recent JSONL file
    let lastActivity = 0;
    for (const f of jsonlFiles) {
      const stat = fs.statSync(path.join(dirPath, f));
      if (stat.mtimeMs > lastActivity) lastActivity = stat.mtimeMs;
    }

    // Derive a friendly name from cwd
    const name = path.basename(cwd);

    projects.push({
      dirName,
      cwd: cwd || 'Unknown',
      name,
      conversationCount: jsonlFiles.length,
      lastActivity: new Date(lastActivity).toISOString(),
    });
  }

  // Sort by last activity desc
  projects.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

  projectCache = projects;
  lastCacheTime = now;
  return projects;
}

/**
 * Get conversations for a specific project directory
 */
function getProjectConversations(dirName) {
  const projectsDir = getClaudeProjectsDir();
  const dirPath = path.join(projectsDir, dirName);

  if (!fs.existsSync(dirPath)) return [];

  const jsonlFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));

  const conversations = [];
  for (const file of jsonlFiles) {
    const filePath = path.join(dirPath, file);
    const sessionId = path.basename(file, '.jsonl');
    const firstEntry = readFirstEntry(filePath);

    if (!firstEntry) continue;

    const stat = fs.statSync(filePath);

    // Read first user message for summary
    let firstUserMessage = '';
    let messageCount = 0;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = parseLine(line);
        if (!entry) continue;
        if (entry.type === 'user' && entry.message?.role === 'user') {
          messageCount++;
          if (!firstUserMessage) {
            const content = entry.message.content;
            if (typeof content === 'string') {
              firstUserMessage = content.slice(0, 200);
            } else if (Array.isArray(content)) {
              const textBlock = content.find(b => b.type === 'text');
              if (textBlock) firstUserMessage = textBlock.text.slice(0, 200);
            }
          }
        }
        if (entry.type === 'assistant') messageCount++;
      }
    } catch { /* skip */ }

    // Check for custom name
    const customName = config.getName(dirName, sessionId);

    conversations.push({
      sessionId,
      cwd: firstEntry.cwd,
      gitBranch: firstEntry.gitBranch || null,
      customName: customName || null,
      firstMessage: firstUserMessage || '(no message)',
      messageCount,
      createdAt: firstEntry.timestamp,
      lastActivity: stat.mtime.toISOString(),
    });
  }

  conversations.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  return conversations;
}

/**
 * Parse a full conversation from a JSONL file
 * Returns array of messages (user + assistant, non-sidechain)
 */
function parseConversation(dirName, sessionId) {
  const projectsDir = getClaudeProjectsDir();
  const filePath = path.join(projectsDir, dirName, `${sessionId}.jsonl`);

  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const messages = [];

  for (const line of lines) {
    if (!line.trim()) continue;
    const entry = parseLine(line);
    if (!entry) continue;
    if (entry.isSidechain) continue;
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    if (!entry.message) continue;

    const msg = {
      uuid: entry.uuid,
      type: entry.type,
      role: entry.message.role,
      timestamp: entry.timestamp,
      content: [],
    };

    const rawContent = entry.message.content;
    if (typeof rawContent === 'string') {
      msg.content.push({ type: 'text', text: rawContent });
    } else if (Array.isArray(rawContent)) {
      for (const block of rawContent) {
        if (block.type === 'text') {
          msg.content.push({ type: 'text', text: block.text });
        } else if (block.type === 'thinking') {
          msg.content.push({ type: 'thinking', text: block.thinking });
        } else if (block.type === 'tool_use') {
          msg.content.push({
            type: 'tool_use',
            toolName: block.name,
            toolId: block.id,
            input: block.input,
          });
        } else if (block.type === 'tool_result') {
          msg.content.push({
            type: 'tool_result',
            toolId: block.tool_use_id,
            content: block.content,
            isError: block.is_error || false,
          });
        }
      }
    }

    // Skip empty tool_result-only user messages (they'll be merged into tool_use)
    if (msg.type === 'user' && msg.content.length === 1 && msg.content[0].type === 'tool_result') {
      // Attach result to the previous tool_use message
      const result = msg.content[0];
      // Also include toolUseResult from the entry if available
      if (entry.toolUseResult) {
        result.stdout = entry.toolUseResult.stdout;
        result.stderr = entry.toolUseResult.stderr;
      }
      for (let i = messages.length - 1; i >= 0; i--) {
        const prev = messages[i];
        const toolBlock = prev.content.find(
          b => b.type === 'tool_use' && b.toolId === result.toolId
        );
        if (toolBlock) {
          toolBlock.result = result;
          break;
        }
      }
      continue;
    }

    messages.push(msg);
  }

  return messages;
}

/**
 * Get project MEMORY.md content
 */
function getProjectMemory(dirName) {
  const projectsDir = getClaudeProjectsDir();
  const memoryDir = path.join(projectsDir, dirName, 'memory');
  const memoryFile = path.join(memoryDir, 'MEMORY.md');

  if (fs.existsSync(memoryFile)) {
    return fs.readFileSync(memoryFile, 'utf-8');
  }
  return null;
}

/**
 * Search across conversations
 */
function searchConversations(query, projectDirName = null) {
  const projectsDir = getClaudeProjectsDir();
  const cfg = config.load();
  const scanDirs = cfg.scanDirectories || [];
  const queryLower = query.toLowerCase();
  const results = [];
  const maxResults = 50;

  let dirs;
  if (projectDirName) {
    dirs = [projectDirName];
  } else {
    dirs = fs.readdirSync(projectsDir).filter(d => {
      return fs.statSync(path.join(projectsDir, d)).isDirectory();
    });
  }

  for (const dirName of dirs) {
    if (results.length >= maxResults) break;
    const dirPath = path.join(projectsDir, dirName);
    if (!fs.existsSync(dirPath)) continue;

    const jsonlFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));

    // Check if project is in scan dirs
    if (!projectDirName && scanDirs.length > 0) {
      const firstFile = jsonlFiles[0] ? path.join(dirPath, jsonlFiles[0]) : null;
      if (firstFile) {
        const firstEntry = readFirstEntry(firstFile);
        if (firstEntry && firstEntry.cwd) {
          const inScanDir = scanDirs.some(sd => firstEntry.cwd.startsWith(sd));
          if (!inScanDir) continue;
        }
      }
    }

    for (const file of jsonlFiles) {
      if (results.length >= maxResults) break;
      const filePath = path.join(dirPath, file);
      const sessionId = path.basename(file, '.jsonl');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        let cwd = null;

        for (const line of lines) {
          if (!line.trim()) continue;
          const entry = parseLine(line);
          if (!entry) continue;
          if (!cwd && entry.cwd) cwd = entry.cwd;
          if (entry.isSidechain) continue;
          if (entry.type !== 'user' && entry.type !== 'assistant') continue;

          const msgContent = entry.message?.content;
          let text = '';
          if (typeof msgContent === 'string') {
            text = msgContent;
          } else if (Array.isArray(msgContent)) {
            text = msgContent
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join(' ');
          }

          if (text.toLowerCase().includes(queryLower)) {
            // Find the matching snippet
            const idx = text.toLowerCase().indexOf(queryLower);
            const start = Math.max(0, idx - 80);
            const end = Math.min(text.length, idx + query.length + 80);
            const snippet = (start > 0 ? '...' : '') +
              text.slice(start, end) +
              (end < text.length ? '...' : '');

            results.push({
              projectDirName: dirName,
              projectName: cwd ? path.basename(cwd) : dirName,
              sessionId,
              cwd,
              type: entry.type,
              snippet,
              timestamp: entry.timestamp,
            });

            if (results.length >= maxResults) break;
          }
        }
      } catch { /* skip unreadable files */ }
    }
  }

  return results;
}

/**
 * Get dashboard stats
 */
function getDashboardStats() {
  const projects = enumerateProjects();
  let totalConversations = 0;
  for (const p of projects) {
    totalConversations += p.conversationCount;
  }

  // Recent conversations (last 10)
  const recent = [];
  for (const p of projects) {
    const convos = getProjectConversations(p.dirName);
    for (const c of convos) {
      recent.push({ ...c, projectDirName: p.dirName, projectName: p.name });
    }
  }
  recent.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

  return {
    totalProjects: projects.length,
    totalConversations,
    recentConversations: recent.slice(0, 15),
    activeProjects: projects.slice(0, 10),
  };
}

/**
 * Sync memory files from ~/.claude/projects/{dir}/memory/ to the actual project folder
 */
function syncProjectMemory(dirName) {
  const projectsDir = getClaudeProjectsDir();
  const memoryDir = path.join(projectsDir, dirName, 'memory');

  if (!fs.existsSync(memoryDir)) {
    return { success: false, error: 'No memory directory found for this project' };
  }

  // Find the project's cwd
  const projects = enumerateProjects();
  const project = projects.find(p => p.dirName === dirName);
  if (!project || !project.cwd || project.cwd === 'Unknown') {
    return { success: false, error: 'Cannot determine project directory' };
  }

  const targetDir = path.join(project.cwd, 'docs');
  // Create docs/ dir if it doesn't exist
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Copy all files from memory dir
  const files = fs.readdirSync(memoryDir);
  const copied = [];
  for (const file of files) {
    const src = path.join(memoryDir, file);
    const stat = fs.statSync(src);
    if (stat.isFile()) {
      const dest = path.join(targetDir, file);
      fs.copyFileSync(src, dest);
      copied.push(file);
    }
  }

  return { success: true, copied, targetDir };
}

module.exports = {
  enumerateProjects,
  getProjectConversations,
  parseConversation,
  getProjectMemory,
  syncProjectMemory,
  searchConversations,
  getDashboardStats,
};
