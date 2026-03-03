/**
 * Dashboard page — overview stats + recent conversations
 */
const DashboardPage = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Dashboard</h1>
        <p class="subtitle">Claude Code activity overview</p>
      </div>
      <div class="stats-row" id="stats-row">
        <div class="stat-card"><div class="stat-value">-</div><div class="stat-label">Projects</div></div>
        <div class="stat-card"><div class="stat-value">-</div><div class="stat-label">Conversations</div></div>
      </div>
      <div class="section">
        <div class="section-title">Recent Conversations</div>
        <div id="recent-list" class="conversation-list">
          <div class="loading-container"><div class="spinner"></div></div>
        </div>
      </div>
      <div class="section">
        <div class="section-title">Active Projects</div>
        <div id="active-projects" class="card-grid">
          <div class="loading-container"><div class="spinner"></div></div>
        </div>
      </div>
    `;

    try {
      const data = await API.dashboard();

      // Stats
      document.getElementById('stats-row').innerHTML = `
        <div class="stat-card"><div class="stat-value">${data.totalProjects}</div><div class="stat-label">Projects</div></div>
        <div class="stat-card"><div class="stat-value">${data.totalConversations}</div><div class="stat-label">Conversations</div></div>
      `;

      // Recent conversations
      const recentList = document.getElementById('recent-list');
      if (data.recentConversations.length === 0) {
        recentList.innerHTML = '<div class="empty-state"><p>No conversations found</p></div>';
      } else {
        recentList.innerHTML = data.recentConversations.map(c => `
          <a href="#/conversation/${encodeURIComponent(c.projectDirName)}/${c.sessionId}" class="conversation-item">
            <div class="title">${escapeHtml(c.customName || c.firstMessage)}</div>
            <div class="meta">
              <span>${escapeHtml(c.projectName)}</span>
              <span>${timeAgo(c.lastActivity)}</span>
              <span>${c.messageCount} messages</span>
            </div>
          </a>
        `).join('');
      }

      // Active projects
      const projectsGrid = document.getElementById('active-projects');
      if (data.activeProjects.length === 0) {
        projectsGrid.innerHTML = '<div class="empty-state"><p>No projects found</p></div>';
      } else {
        projectsGrid.innerHTML = data.activeProjects.map(p => `
          <a href="#/project/${encodeURIComponent(p.dirName)}" class="card card-link">
            <div class="card-title">${escapeHtml(p.name)}</div>
            <div style="font-size:12px;color:var(--text-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.cwd)}</div>
            <div class="card-meta">
              <span>${p.conversationCount} conversations</span>
              <span>${timeAgo(p.lastActivity)}</span>
            </div>
          </a>
        `).join('');
      }
    } catch (err) {
      container.innerHTML += `<div class="empty-state"><p>Error loading dashboard: ${escapeHtml(err.message)}</p></div>`;
    }
  },
};
