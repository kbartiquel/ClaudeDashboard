/**
 * SPA Router — hash-based routing with tab support
 */

// Utility functions
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 2592000) return Math.floor(seconds / 86400) + 'd ago';
  return date.toLocaleDateString();
}

// Router
const Router = {
  init() {
    window.addEventListener('hashchange', () => this.handleRoute());
    Sidebar.init();
    TabManager.init();
    MessageRenderer.initMarked();
    this.handleRoute();
  },

  async handleRoute() {
    const hash = window.location.hash || '#/';
    const pageContent = document.getElementById('page-content');
    const terminalsContainer = document.getElementById('terminals-container');

    // Terminal tab requests from hash
    if (hash.startsWith('#/terminal')) {
      const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
      const cwd = params.get('cwd');
      const resume = params.get('resume') || null;
      if (cwd) {
        const name = cwd.split('/').filter(Boolean).pop() || cwd;
        TabManager.openTerminal(name, cwd, resume);
        return;
      }
    }

    // For page routes, hide terminals and show page content
    pageContent.style.display = 'block';
    terminalsContainer.style.display = 'none';

    // Hide all terminal tab containers
    for (const tab of TabManager.tabs) {
      if (tab.type === 'terminal' && tab.el) {
        tab.el.style.display = 'none';
      }
    }

    // Deactivate tab bar active state for page routes
    TabManager.activeTabId = null;
    TabManager.renderTabs();

    const loading = document.getElementById('page-loading');
    loading.style.display = 'flex';
    pageContent.innerHTML = '';

    try {
      if (hash === '#/' || hash === '#') {
        Sidebar.setActive('dashboard');
        await DashboardPage.render(pageContent);

      } else if (hash === '#/projects') {
        Sidebar.setActive('projects');
        await ProjectsPage.render(pageContent);

      } else if (hash.startsWith('#/project/')) {
        Sidebar.setActive(null);
        const projectId = decodeURIComponent(hash.slice('#/project/'.length));
        Sidebar.setProjectActive(projectId);
        await ProjectDetailPage.render(pageContent, projectId);

      } else if (hash.startsWith('#/conversation/')) {
        Sidebar.setActive(null);
        const parts = hash.slice('#/conversation/'.length).split('/');
        const projectId = decodeURIComponent(parts[0]);
        const sessionId = parts[1];
        await ConversationPage.render(pageContent, projectId, sessionId);

      } else if (hash === '#/settings') {
        Sidebar.setActive('settings');
        await SettingsPage.render(pageContent);

      } else if (hash.startsWith('#/search')) {
        Sidebar.setActive(null);
        const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
        await SearchPage.render(pageContent, params);

      } else {
        pageContent.innerHTML = '<div class="empty-state"><p>Page not found</p></div>';
      }
    } catch (err) {
      pageContent.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }

    loading.style.display = 'none';
  },
};

// Block drag-and-drop at document level (prevents floating images / Electron navigation)
document.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
document.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); });

// Boot
document.addEventListener('DOMContentLoaded', () => {
  Router.init();
});
