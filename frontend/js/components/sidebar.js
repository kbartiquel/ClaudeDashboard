/**
 * Sidebar component — nav, project tree, search, theme toggle
 */
const Sidebar = {
  projects: [],

  init() {
    // Search
    const searchInput = document.getElementById('global-search');
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && searchInput.value.trim()) {
        window.location.hash = '#/search?q=' + encodeURIComponent(searchInput.value.trim());
        searchInput.blur();
      }
    });

    // Theme toggle
    const themeSwitch = document.getElementById('theme-switch');
    const themeLabel = document.getElementById('theme-label');
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    themeSwitch.checked = saved === 'light';
    themeLabel.textContent = saved === 'light' ? 'Light' : 'Dark';

    themeSwitch.addEventListener('change', () => {
      const theme = themeSwitch.checked ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('theme', theme);
      themeLabel.textContent = theme === 'light' ? 'Light' : 'Dark';
    });

    // Load project tree
    this.loadProjectTree();
  },

  setActive(page) {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('active');
      if (link.dataset.page === page) {
        link.classList.add('active');
      }
    });
    // Clear project tree active
    document.querySelectorAll('.tree-project').forEach(el => {
      el.classList.remove('active');
    });
  },

  setProjectActive(dirName) {
    document.querySelectorAll('.tree-project').forEach(el => {
      el.classList.remove('active');
      if (el.dataset.dir === dirName) {
        el.classList.add('active');
      }
    });
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  },

  async loadProjectTree() {
    const tree = document.getElementById('project-tree');
    try {
      this.projects = await API.projects();
      this.renderTree(tree);
    } catch {
      tree.innerHTML = '<div style="padding:8px 16px;font-size:12px;color:var(--text-muted);">Failed to load</div>';
    }
  },

  renderTree(container) {
    if (this.projects.length === 0) {
      container.innerHTML = '<div style="padding:8px 16px;font-size:12px;color:var(--text-muted);">No projects found</div>';
      return;
    }

    container.innerHTML = '';

    for (const p of this.projects) {
      const item = document.createElement('div');
      item.className = 'tree-item';
      item.dataset.dir = p.dirName;

      item.innerHTML = `
        <div class="tree-project" data-dir="${escapeHtml(p.dirName)}">
          <span class="tree-arrow">&#9654;</span>
          <span class="tree-project-name">${escapeHtml(p.name)}</span>
          <span class="tree-badge">${p.conversationCount}</span>
          <button class="tree-open-btn" title="Open in Claude Dashboard">&#9002;</button>
          <button class="tree-ext-btn" title="Open in external Terminal">&#8599;</button>
        </div>
        <div class="tree-children" style="display:none;"></div>
      `;

      const projectRow = item.querySelector('.tree-project');
      const childrenEl = item.querySelector('.tree-children');
      const arrow = item.querySelector('.tree-arrow');
      const openBtn = item.querySelector('.tree-open-btn');
      const extBtn = item.querySelector('.tree-ext-btn');

      // Open in external Terminal.app
      extBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.openExternalTerminal) {
          window.electronAPI.openExternalTerminal(p.cwd);
        }
      });

      // Click project name → expand/collapse conversations
      projectRow.addEventListener('click', async (e) => {
        if (e.target === openBtn || e.target === extBtn) return;
        const isOpen = childrenEl.style.display !== 'none';
        if (isOpen) {
          childrenEl.style.display = 'none';
          arrow.classList.remove('expanded');
        } else {
          arrow.classList.add('expanded');
          childrenEl.style.display = 'block';
          if (!childrenEl.dataset.loaded) {
            childrenEl.innerHTML = '<div style="padding:4px 0 4px 28px;font-size:11px;color:var(--text-muted);">Loading...</div>';
            await this.loadProjectChildren(p.dirName, p.cwd, childrenEl);
            childrenEl.dataset.loaded = 'true';
          }
        }
      });

      // Open terminal button
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        TabManager.openTerminal(p.name, p.cwd, null, p.dirName);
      });

      container.appendChild(item);
    }
  },

  async loadProjectChildren(dirName, cwd, container) {
    try {
      const project = await API.project(dirName);
      const convos = project.conversations || [];

      if (convos.length === 0) {
        container.innerHTML = '<div style="padding:4px 0 4px 28px;font-size:11px;color:var(--text-muted);">No conversations</div>';
        return;
      }

      container.innerHTML = '';
      for (const c of convos.slice(0, 20)) {
        const child = document.createElement('a');
        child.className = 'tree-conversation';
        child.href = `#/conversation/${encodeURIComponent(dirName)}/${c.sessionId}`;
        const displayText = c.customName || c.firstMessage;
        const label = displayText.slice(0, 40) + (displayText.length > 40 ? '...' : '');
        child.innerHTML = `
          <span class="tree-conv-text">${escapeHtml(label)}</span>
          <span class="tree-conv-time">${timeAgo(c.lastActivity)}</span>
        `;
        container.appendChild(child);
      }
    } catch {
      container.innerHTML = '<div style="padding:4px 0 4px 28px;font-size:11px;color:var(--red);">Error loading</div>';
    }
  },
};
