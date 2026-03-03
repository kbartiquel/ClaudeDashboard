/**
 * Project detail page — conversation list + memory
 */
const ProjectDetailPage = {
  async render(container, projectId) {
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
      <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="open-terminal-btn">&#9002; Open Terminal</button>
        <button class="btn" id="sync-memory-btn">&#8635; Sync Memory to Project</button>
      </div>
      <div id="sync-status" style="font-size:13px;margin-bottom:16px;display:none;"></div>
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
        const statusEl = document.getElementById('sync-status');
        statusEl.style.display = 'block';
        statusEl.style.color = 'var(--text-muted)';
        statusEl.textContent = 'Syncing memory files...';
        try {
          const result = await API.syncMemory(projectId);
          if (result.success) {
            statusEl.style.color = 'var(--green)';
            statusEl.textContent = `Synced ${result.copied.length} file(s) to ${result.targetDir}`;
          } else {
            statusEl.style.color = 'var(--red)';
            statusEl.textContent = result.error;
          }
        } catch (err) {
          statusEl.style.color = 'var(--red)';
          statusEl.textContent = 'Failed: ' + err.message;
        }
        setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
      });

      // Memory
      if (memoryResp.content) {
        document.getElementById('memory-section').style.display = '';
        const memEl = document.getElementById('memory-content');
        memEl.innerHTML = MessageRenderer.renderMarkdown(memoryResp.content);
      }

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
};
