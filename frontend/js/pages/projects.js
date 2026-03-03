/**
 * Projects listing page — card grid of all projects
 */
const ProjectsPage = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Projects</h1>
        <p class="subtitle">All Claude Code projects in your scan directories</p>
      </div>
      <div id="projects-grid" class="card-grid">
        <div class="loading-container"><div class="spinner"></div></div>
      </div>
    `;

    try {
      const projects = await API.projects();
      const grid = document.getElementById('projects-grid');

      if (projects.length === 0) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column: 1/-1;">
            <div class="icon">&#9776;</div>
            <p>No projects found. Check your scan directories in Settings.</p>
          </div>
        `;
        return;
      }

      grid.innerHTML = projects.map(p => `
        <a href="#/project/${encodeURIComponent(p.dirName)}" class="card card-link">
          <div class="card-title">${escapeHtml(p.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.cwd)}</div>
          <div class="card-meta">
            <span>${p.conversationCount} conversations</span>
            <span>${timeAgo(p.lastActivity)}</span>
          </div>
        </a>
      `).join('');
    } catch (err) {
      document.getElementById('projects-grid').innerHTML =
        `<div class="empty-state" style="grid-column:1/-1;"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }
  },
};
