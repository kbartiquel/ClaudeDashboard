/**
 * Settings page — configure scan directories
 */
const SettingsPage = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h1>Settings</h1>
        <p class="subtitle">Configure scan directories and preferences</p>
      </div>
      <div class="section">
        <div class="section-title">Scan Directories</div>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">
          Projects from these directories will appear in the dashboard.
          Only projects with Claude Code conversations will show up.
        </p>
        <div id="scan-dirs-list"></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-primary" id="browse-scan-dir-btn">Browse Folder...</button>
          <button class="btn" id="add-dir-btn" style="display:none;">Add</button>
          <input type="hidden" id="new-dir-input" />
        </div>
      </div>
      <div class="section" style="margin-top:32px;">
        <div class="section-title">Claude Projects Directory</div>
        <div class="form-group">
          <label>Path to Claude's projects directory</label>
          <input type="text" id="claude-projects-dir" readonly style="opacity:0.7;" />
        </div>
      </div>
      <div id="settings-status" style="margin-top:16px;font-size:13px;color:var(--green);display:none;">Settings saved!</div>
    `;

    try {
      const settings = await API.settings();
      this.currentSettings = settings;

      document.getElementById('claude-projects-dir').value = settings.claudeProjectsDir;
      this.renderDirsList(settings.scanDirectories || []);

      // Browse folder button for adding scan directories
      document.getElementById('browse-scan-dir-btn').addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.pickFolder) {
          const dir = await window.electronAPI.pickFolder();
          if (dir) {
            const dirs = [...(this.currentSettings.scanDirectories || [])];
            if (!dirs.includes(dir)) {
              dirs.push(dir);
              await this.saveDirs(dirs);
            }
          }
        }
      });
    } catch (err) {
      container.innerHTML += `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }
  },

  renderDirsList(dirs) {
    const listEl = document.getElementById('scan-dirs-list');
    if (dirs.length === 0) {
      listEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No directories configured. Click "Browse Folder" to add your projects directory, or directories will be auto-detected from your Claude Code history on next launch.</div>';
      return;
    }
    listEl.innerHTML = dirs.map((dir, i) => `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <div style="flex:1;padding:8px 12px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:var(--radius);font-size:13px;">${escapeHtml(dir)}</div>
        <button class="btn btn-danger btn-sm" onclick="SettingsPage.removeDir(${i})">Remove</button>
      </div>
    `).join('');
  },

  async addDir() {
    const input = document.getElementById('new-dir-input');
    const dir = input.value.trim();
    if (!dir) return;

    const dirs = [...(this.currentSettings.scanDirectories || [])];
    if (!dirs.includes(dir)) {
      dirs.push(dir);
    }
    input.value = '';

    await this.saveDirs(dirs);
  },

  async removeDir(index) {
    const dirs = [...(this.currentSettings.scanDirectories || [])];
    dirs.splice(index, 1);
    await this.saveDirs(dirs);
  },

  async saveDirs(dirs) {
    try {
      const updated = await API.updateSettings({ scanDirectories: dirs });
      this.currentSettings = updated;
      this.renderDirsList(updated.scanDirectories || []);
      const status = document.getElementById('settings-status');
      status.style.display = 'block';
      setTimeout(() => { status.style.display = 'none'; }, 2000);
    } catch (err) {
      alert('Failed to save: ' + err.message);
    }
  },
};
