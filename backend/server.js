const express = require('express');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');
const claudeData = require('./claude-data');
const config = require('./config');
const terminal = require('./terminal');

function createServer() {
  const app = express();
  app.use(express.json());

  // Serve frontend static files
  app.use(express.static(path.join(__dirname, '..', 'frontend')));

  // ---- API Routes ----

  // Dashboard stats
  app.get('/api/dashboard', (req, res) => {
    try {
      const stats = claudeData.getDashboardStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // List all projects
  app.get('/api/projects', (req, res) => {
    try {
      const projects = claudeData.enumerateProjects(req.query.refresh === 'true');
      res.json(projects);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Project detail + conversations
  app.get('/api/projects/:id', (req, res) => {
    try {
      const dirName = decodeURIComponent(req.params.id);
      const conversations = claudeData.getProjectConversations(dirName);
      const projects = claudeData.enumerateProjects();
      const project = projects.find(p => p.dirName === dirName);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }
      res.json({ ...project, conversations });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Project memory
  app.get('/api/projects/:id/memory', (req, res) => {
    try {
      const dirName = decodeURIComponent(req.params.id);
      const memory = claudeData.getProjectMemory(dirName);
      res.json({ content: memory });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sync memory — copy ~/.claude/projects/{dir}/memory/ files to the actual project folder
  app.post('/api/projects/:id/sync-memory', (req, res) => {
    try {
      const dirName = decodeURIComponent(req.params.id);
      const result = claudeData.syncProjectMemory(dirName);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Full conversation
  app.get('/api/conversations/:projectId/:sessionId', (req, res) => {
    try {
      const projectId = decodeURIComponent(req.params.projectId);
      const sessionId = req.params.sessionId;
      const messages = claudeData.parseConversation(projectId, sessionId);
      if (!messages) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      // Include project cwd for resume functionality
      const projects = claudeData.enumerateProjects();
      const project = projects.find(p => p.dirName === projectId);
      res.json({ messages, cwd: project ? project.cwd : null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Rename conversation
  app.put('/api/conversations/:projectId/:sessionId/name', (req, res) => {
    try {
      const projectId = decodeURIComponent(req.params.projectId);
      const sessionId = req.params.sessionId;
      const { name } = req.body;
      config.saveName(projectId, sessionId, name);
      res.json({ success: true, name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Search
  app.get('/api/search', (req, res) => {
    try {
      const { q, project } = req.query;
      if (!q) {
        return res.status(400).json({ error: 'Query parameter "q" required' });
      }
      const results = claudeData.searchConversations(q, project || null);
      res.json({ results, query: q });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Settings
  app.get('/api/settings', (req, res) => {
    res.json(config.load());
  });

  app.put('/api/settings', (req, res) => {
    try {
      const updated = config.update(req.body);
      // Force cache refresh after settings change
      claudeData.enumerateProjects(true);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Account info (claude auth status)
  app.get('/api/account', (req, res) => {
    try {
      const env = terminal.getShellEnv();
      const output = execSync('claude auth status --json', {
        env,
        timeout: 10000,
        encoding: 'utf-8',
      });
      const account = JSON.parse(output);
      res.json(account);
    } catch (err) {
      res.status(500).json({ error: 'Failed to get account info', loggedIn: false });
    }
  });

  // Terminal sessions list
  app.get('/api/terminal/sessions', (req, res) => {
    res.json(terminal.listSessions());
  });

  // Resumable sessions from previous launch
  app.get('/api/terminal/resumable', (req, res) => {
    res.json(terminal.getResumableSessions());
  });

  // Kill terminal session
  app.delete('/api/terminal/sessions/:id', (req, res) => {
    const killed = terminal.killSession(req.params.id);
    res.json({ success: killed });
  });

  // Fallback: serve index.html for SPA
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
    }
  });

  // Wrap in HTTP server for WebSocket support
  const server = http.createServer(app);

  // WebSocket server for terminal
  const wss = new WebSocket.Server({ server, path: '/ws/terminal' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const mode = url.searchParams.get('mode');

    if (mode === 'auth') {
      terminal.createAuthSession(ws);
    } else {
      const projectPath = url.searchParams.get('cwd') || process.env.HOME;
      const resumeSessionId = url.searchParams.get('resume') || null;
      terminal.createSession(ws, projectPath, resumeSessionId);
    }
  });

  return server;
}

module.exports = { createServer };
