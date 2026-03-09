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
      <div class="section" style="margin-top:32px;">
        <div class="section-title">Anthropic API Key</div>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">
          Required for the <strong>Generate Memory</strong> feature. Stored locally in <code>~/.claude-dashboard/config.json</code> and never sent anywhere except the Anthropic API.
        </p>
        <div id="api-key-status" style="font-size:13px;margin-bottom:12px;"></div>
        <div style="display:flex;gap:8px;align-items:center;">
          <input type="password" id="api-key-input" placeholder="sk-ant-..." style="flex:1;max-width:420px;" />
          <button class="btn btn-primary" id="save-api-key-btn">Save</button>
          <button class="btn btn-danger" id="remove-api-key-btn" style="display:none;">Remove</button>
        </div>
      </div>
      <div id="settings-status" style="margin-top:16px;font-size:13px;color:var(--green);display:none;">Settings saved!</div>
    `;

    try {
      const settings = await API.settings();
      this.currentSettings = settings;

      document.getElementById('claude-projects-dir').value = settings.claudeProjectsDir;
      this.renderDirsList(settings.scanDirectories || []);
      this.renderApiKey(settings.anthropicApiKey || '');

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

  renderApiKey(currentKey) {
    const statusEl = document.getElementById('api-key-status');
    const removeBtn = document.getElementById('remove-api-key-btn');
    const input = document.getElementById('api-key-input');

    if (currentKey) {
      statusEl.style.color = 'var(--green)';
      statusEl.textContent = `API key saved (${currentKey.slice(0, 10)}…)`;
      removeBtn.style.display = 'inline-block';
      input.value = '';
      input.placeholder = 'Enter new key to replace…';
    } else {
      statusEl.style.color = 'var(--text-muted)';
      statusEl.textContent = 'No API key saved.';
      removeBtn.style.display = 'none';
      input.placeholder = 'sk-ant-…';
    }

    document.getElementById('save-api-key-btn').onclick = async () => {
      const key = input.value.trim();
      if (!key) return;
      try {
        const updated = await API.updateSettings({ anthropicApiKey: key });
        this.currentSettings = updated;
        this.renderApiKey(updated.anthropicApiKey || '');
        this._flashStatus('API key saved!');
      } catch (err) {
        this._flashStatus('Failed: ' + err.message, true);
      }
    };

    document.getElementById('remove-api-key-btn').onclick = async () => {
      try {
        const updated = await API.updateSettings({ anthropicApiKey: '' });
        this.currentSettings = updated;
        this.renderApiKey('');
        this._flashStatus('API key removed.');
      } catch (err) {
        this._flashStatus('Failed: ' + err.message, true);
      }
    };
  },

  _flashStatus(message, isError = false) {
    const el = document.getElementById('settings-status');
    el.style.color = isError ? 'var(--red)' : 'var(--green)';
    el.textContent = message;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2500);
  },

  async saveDirs(dirs) {
    try {
      const updated = await API.updateSettings({ scanDirectories: dirs });
      this.currentSettings = updated;
      this.renderDirsList(updated.scanDirectories || []);
      this._flashStatus('Settings saved!');
    } catch (err) {
      this._flashStatus('Failed: ' + err.message, true);
    }
  },
};
