/**
 * Project detail page — conversation list + memory
 */
const ProjectDetailPage = {
  async render(container, projectId) {
    const TOOLTIP_TEXT =
      'Reads all conversation sessions for this project and uses Claude AI to extract ' +
      'key context — tech stack, decisions, patterns, features, and conventions — ' +
      'into a CLAUDE.md file stored in ~/.claude/projects/. ' +
      'This file is automatically loaded at the start of every future Claude Code session, ' +
      'giving Claude instant context without you needing to re-explain the project.';

    container.innerHTML = `
      <div class="breadcrumb">
        <a href="#/projects">Projects</a>
        <span class="sep">/</span>
        <span id="project-name">Loading...</span>
      </div>
      <div class="page-header">
        <h1 id="project-title">Loading...</h1>
        <p class="subtitle" id="project-path"></p>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;align-items:center;">
        <button class="btn btn-primary" id="open-terminal-btn">&#9002; Open Terminal</button>
        <button class="btn" id="sync-memory-btn">&#8635; Sync Memory to Project</button>
        <div style="display:inline-flex;align-items:center;gap:6px;">
          <button class="btn" id="generate-memory-btn">&#9889; Generate Memory</button>
          <span
            title="${escapeHtml(TOOLTIP_TEXT)}"
            style="
              display:inline-flex;align-items:center;justify-content:center;
              width:18px;height:18px;border-radius:50%;
              background:var(--border);color:var(--text-muted);
              font-size:11px;font-weight:bold;cursor:help;flex-shrink:0;
            "
          >?</span>
        </div>
      </div>
      <div id="status-bar" style="font-size:13px;margin-bottom:16px;display:none;"></div>
      <div id="merge-prompt" style="display:none;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:16px;">
        <p style="margin:0 0 12px;font-size:14px;">
          A <code>CLAUDE.md</code> already exists for this project. What would you like to do?
        </p>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary" id="merge-btn">Merge — add new insights</button>
          <button class="btn" id="replace-btn">Replace — start fresh</button>
          <button class="btn" id="cancel-generate-btn">Cancel</button>
        </div>
      </div>
      <div class="section" id="memory-section" style="display:none;">
        <div class="section-title">Project Memory</div>
        <div id="memory-content" class="memory-content"></div>
      </div>
      <div class="section">
        <div class="section-title">Conversations</div>
        <div id="conversations-list" class="conversation-list">
          <div class="loading-container"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    try {
      const [project, memoryResp] = await Promise.all([
        API.project(projectId),
        API.projectMemory(projectId),
      ]);

      document.getElementById('project-name').textContent = project.name;
      document.getElementById('project-title').textContent = project.name;
      document.getElementById('project-path').textContent = project.cwd;

      // Terminal button
      document.getElementById('open-terminal-btn').addEventListener('click', () => {
        TabManager.openTerminal(project.name, project.cwd, null, projectId);
      });

      // Sync memory button
      document.getElementById('sync-memory-btn').addEventListener('click', async () => {
        this._showStatus('Syncing memory files...', 'muted');
        try {
          const result = await API.syncMemory(projectId);
          if (result.success) {
            this._showStatus(`Synced ${result.copied.length} file(s) to ${result.targetDir}`, 'green');
          } else {
            this._showStatus(result.error, 'red');
          }
        } catch (err) {
          this._showStatus('Failed: ' + err.message, 'red');
        }
      });

      // Generate Memory button — check if CLAUDE.md exists first
      document.getElementById('generate-memory-btn').addEventListener('click', async () => {
        let claudeMdStatus;
        try {
          claudeMdStatus = await API.getClaudeMd(projectId);
        } catch {
          claudeMdStatus = { exists: false };
        }

        if (claudeMdStatus.exists) {
          document.getElementById('merge-prompt').style.display = '';
          document.getElementById('generate-memory-btn').disabled = true;
        } else {
          await this._runGenerate(projectId, false);
        }
      });

      // Merge button
      document.getElementById('merge-btn').addEventListener('click', async () => {
        document.getElementById('merge-prompt').style.display = 'none';
        document.getElementById('generate-memory-btn').disabled = false;
        await this._runGenerate(projectId, true);
      });

      // Replace button
      document.getElementById('replace-btn').addEventListener('click', async () => {
        document.getElementById('merge-prompt').style.display = 'none';
        document.getElementById('generate-memory-btn').disabled = false;
        await this._runGenerate(projectId, false);
      });

      // Cancel button
      document.getElementById('cancel-generate-btn').addEventListener('click', () => {
        document.getElementById('merge-prompt').style.display = 'none';
        document.getElementById('generate-memory-btn').disabled = false;
      });

      // Memory section
      this._renderMemory(memoryResp.content);

      // Conversations
      const listEl = document.getElementById('conversations-list');
      if (project.conversations.length === 0) {
        listEl.innerHTML = '<div class="empty-state"><p>No conversations in this project</p></div>';
      } else {
        listEl.innerHTML = project.conversations.map(c => `
          <a href="#/conversation/${encodeURIComponent(projectId)}/${c.sessionId}" class="conversation-item">
            <div class="title">${escapeHtml(c.customName || c.firstMessage)}</div>
            <div class="meta">
              <span>${timeAgo(c.lastActivity)}</span>
              <span>${c.messageCount} messages</span>
              ${c.gitBranch ? `<span class="badge badge-blue">${escapeHtml(c.gitBranch)}</span>` : ''}
            </div>
          </a>
        `).join('');
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }
  },

  async _runGenerate(projectId, merge) {
    const btn = document.getElementById('generate-memory-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }
    this._showStatus(
      merge ? 'Merging new insights into existing CLAUDE.md…' : 'Generating CLAUDE.md from session history…',
      'muted'
    );

    try {
      const result = await API.generateMemory(projectId, merge);
      if (!result.success) throw new Error(result.error || 'Unknown error');

      this._showStatus(
        `CLAUDE.md ${merge ? 'updated' : 'generated'} successfully and saved to ~/.claude/projects/.`,
        'green'
      );
      this._renderMemory(result.content);
    } catch (err) {
      this._showStatus('Failed: ' + err.message, 'red');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '⚡ Generate Memory'; }
    }
  },

  _renderMemory(content) {
    const section = document.getElementById('memory-section');
    const memEl = document.getElementById('memory-content');
    if (!section || !memEl) return;
    if (content) {
      section.style.display = '';
      memEl.innerHTML = MessageRenderer.renderMarkdown(content);
    } else {
      section.style.display = 'none';
    }
  },

  _showStatus(message, type) {
    const el = document.getElementById('status-bar');
    if (!el) return;
    const colors = { green: 'var(--green)', red: 'var(--red)', muted: 'var(--text-muted)' };
    el.style.display = 'block';
    el.style.color = colors[type] || colors.muted;
    el.textContent = message;
    if (type === 'green' || type === 'red') {
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
  },
};
