/**
 * Tab Manager — manages multiple open tabs (pages + terminal sessions)
 *
 * Each tab: { id, title, type, cwd, resumeSessionId, termInstance, termWs, termFitAddon, el }
 *   type: 'page' | 'terminal'
 */
const TabManager = {
  tabs: [],
  activeTabId: null,
  _idCounter: 0,

  init() {
    // "+" button in sidebar opens folder picker
    const newBtn = document.getElementById('new-session-btn');
    if (newBtn) {
      newBtn.addEventListener('click', async () => {
        if (window.electronAPI && window.electronAPI.pickFolder) {
          const dir = await window.electronAPI.pickFolder();
          if (dir) {
            const name = dir.split('/').filter(Boolean).pop() || dir;
            TabManager.openTerminal(name, dir);
          }
        }
      });
    }
  },

  /** Render the tab bar */
  renderTabs() {
    const container = document.getElementById('tabs-container');
    container.innerHTML = '';

    for (const tab of this.tabs) {
      const tabEl = document.createElement('div');
      tabEl.className = 'tab' + (tab.id === this.activeTabId ? ' active' : '');
      tabEl.dataset.tabId = tab.id;

      const icon = tab.type === 'terminal' ? '&#9002;' : tab.type === 'terminal-auth' ? '&#9030;' : '&#9632;';
      tabEl.innerHTML = `
        <span class="tab-icon">${icon}</span>
        <span class="tab-title">${escapeHtml(tab.title)}</span>
        <button class="tab-close" data-tab-id="${tab.id}">&times;</button>
      `;

      tabEl.addEventListener('click', (e) => {
        if (!e.target.classList.contains('tab-close')) {
          this.activateTab(tab.id);
        }
      });

      tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      container.appendChild(tabEl);
    }
  },

  /** Open a page tab (dashboard, settings, etc.) */
  openPage(title, renderFn) {
    // Check if a page tab with same title exists
    const existing = this.tabs.find(t => t.type === 'page' && t.title === title);
    if (existing) {
      this.activateTab(existing.id);
      return existing;
    }

    const id = 'tab-' + (++this._idCounter);
    const tab = { id, title, type: 'page', renderFn, el: null };
    this.tabs.push(tab);
    this.renderTabs();
    this.activateTab(id);
    return tab;
  },

  /** Open a terminal tab for a project */
  openTerminal(title, cwd, resumeSessionId, projectDirName) {
    const id = 'tab-' + (++this._idCounter);
    const tab = {
      id, title, type: 'terminal', cwd,
      resumeSessionId: resumeSessionId || null,
      projectDirName: projectDirName || null,
      termInstance: null, termWs: null, termFitAddon: null, el: null,
    };
    this.tabs.push(tab);
    this.renderTabs();
    this.activateTab(id);
    return tab;
  },

  /** Switch to a tab */
  async activateTab(tabId) {
    this.activeTabId = tabId;
    this.renderTabs();

    const pageContent = document.getElementById('page-content');
    const terminalsContainer = document.getElementById('terminals-container');
    const loading = document.getElementById('page-loading');

    // Hide all terminal containers
    for (const tab of this.tabs) {
      if ((tab.type === 'terminal' || tab.type === 'terminal-auth') && tab.el) {
        tab.el.style.display = 'none';
      }
    }

    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.type === 'page') {
      // Show page, hide terminals
      pageContent.style.display = 'block';
      terminalsContainer.style.display = 'none';

      loading.style.display = 'flex';
      pageContent.innerHTML = '';
      try {
        await tab.renderFn(pageContent);
      } catch (err) {
        pageContent.innerHTML = `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
      }
      loading.style.display = 'none';

    } else if (tab.type === 'terminal' || tab.type === 'terminal-auth') {
      // Hide page, show terminals
      pageContent.style.display = 'none';
      terminalsContainer.style.display = 'block';

      if (!tab.el) {
        // First time — create terminal
        tab.el = document.createElement('div');
        tab.el.className = 'terminal-tab-container';

        if (tab.type === 'terminal-auth') {
          tab.el.innerHTML = `
            <div class="terminal-tab-header">
              <span class="terminal-tab-path">Account Switch</span>
              <div class="terminal-tab-status">
                <span class="dot disconnected" id="dot-${tab.id}"></span>
                <span id="status-${tab.id}">Connecting...</span>
              </div>
            </div>
            <div class="terminal-el" id="term-${tab.id}"></div>
          `;
          terminalsContainer.appendChild(tab.el);
          this._initAuthTermInstance(tab);
        } else {
        const syncBtn = tab.projectDirName
          ? `<button class="btn btn-sm terminal-sync-btn" id="sync-btn-${tab.id}" title="Sync memory files to project folder">&#8635; Sync Memory</button>
             <span class="terminal-sync-status" id="sync-status-${tab.id}"></span>`
          : '';
        tab.el.innerHTML = `
          <div class="terminal-tab-header">
            <span class="terminal-tab-path">${escapeHtml(tab.cwd)}</span>
            <div class="terminal-tab-status">
              <span class="terminal-session-id" id="session-id-${tab.id}" style="display:none;">
                <span class="session-id-label">Session:</span>
                <span class="session-id-value" id="session-id-val-${tab.id}"></span>
                <button class="session-id-copy" id="session-id-copy-${tab.id}" title="Copy session ID">&#9112;</button>
              </span>
              ${syncBtn}
              <span class="dot disconnected" id="dot-${tab.id}"></span>
              <span id="status-${tab.id}">Connecting...</span>
              <button class="btn btn-sm" id="reconnect-btn-${tab.id}" style="display:none;margin-left:10px;">Reconnect</button>
            </div>
          </div>
          <div class="terminal-el" id="term-${tab.id}"></div>
        `;
        terminalsContainer.appendChild(tab.el);

        if (tab.projectDirName) {
          const syncBtnEl = document.getElementById(`sync-btn-${tab.id}`);
          const syncStatusEl = document.getElementById(`sync-status-${tab.id}`);
          syncBtnEl.addEventListener('click', async () => {
            syncBtnEl.disabled = true;
            syncStatusEl.style.color = 'var(--text-muted)';
            syncStatusEl.textContent = 'Syncing...';
            try {
              const result = await API.syncMemory(tab.projectDirName);
              if (result.success) {
                syncStatusEl.style.color = 'var(--green)';
                syncStatusEl.textContent = `Synced ${result.copied.length} file(s)`;
              } else {
                syncStatusEl.style.color = 'var(--red)';
                syncStatusEl.textContent = result.error;
              }
            } catch (err) {
              syncStatusEl.style.color = 'var(--red)';
              syncStatusEl.textContent = 'Failed';
            }
            syncBtnEl.disabled = false;
            setTimeout(() => { syncStatusEl.textContent = ''; }, 4000);
          });
        }

        this._initTermInstance(tab);

        // Reconnect button
        const reconnectBtn = document.getElementById(`reconnect-btn-${tab.id}`);
        if (reconnectBtn) {
          reconnectBtn.addEventListener('click', () => this._connectTermWS(tab));
        }
        }
      }

      tab.el.style.display = 'flex';

      // Re-fit after showing
      setTimeout(() => {
        if (tab.termFitAddon) tab.termFitAddon.fit();
      }, 50);
    }

    // Highlight in sidebar
    Sidebar.setActive(null);
  },

  /** Close a tab */
  closeTab(tabId) {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    const tab = this.tabs[idx];

    // Cleanup terminal resources — kill the claude process then close
    if (tab.type === 'terminal' || tab.type === 'terminal-auth') {
      if (tab.termWs && tab.termWs.readyState === WebSocket.OPEN) {
        tab.termWs.send(JSON.stringify({ type: 'kill' }));
      }
      if (tab.termWs) { tab.termWs.close(); tab.termWs = null; }
      if (tab.termInstance) { tab.termInstance.dispose(); tab.termInstance = null; }
      if (tab._resizeHandler) { window.removeEventListener('resize', tab._resizeHandler); }
      if (tab.el) { tab.el.remove(); }
    }

    this.tabs.splice(idx, 1);

    // Switch to neighbor or dashboard
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
        this.activeTabId = next.id;
        this.activateTab(next.id);
      } else {
        this.activeTabId = null;
        // Go back to dashboard
        window.location.hash = '#/';
      }
    }

    this.renderTabs();
  },

  /** Initialize an xterm instance for a terminal tab */
  _initTermInstance(tab) {
    if (typeof Terminal === 'undefined') return;

    const termEl = document.getElementById(`term-${tab.id}`);

    tab.termInstance = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d2c0',
        white: '#b1bac4',
      },
      fontSize: 14,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace",
      cursorBlink: true,
      scrollback: 10000,
    });

    tab.termFitAddon = new FitAddon.FitAddon();
    tab.termInstance.loadAddon(tab.termFitAddon);

    if (typeof WebLinksAddon !== 'undefined') {
      tab.termInstance.loadAddon(new WebLinksAddon.WebLinksAddon());
    }

    tab.termInstance.open(termEl);
    tab.termFitAddon.fit();

    this._connectTermWS(tab);

    // Input
    tab.termInstance.onData((data) => {
      if (tab.termWs && tab.termWs.readyState === WebSocket.OPEN) {
        tab.termWs.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize
    tab.termInstance.onResize(({ cols, rows }) => {
      if (tab.termWs && tab.termWs.readyState === WebSocket.OPEN) {
        tab.termWs.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Drag-and-drop files (images, etc.) into terminal
    termEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      termEl.classList.add('drag-over');
    });
    termEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      termEl.classList.remove('drag-over');
    });
    termEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      termEl.classList.remove('drag-over');
      if (!e.dataTransfer) return;

      try {
        const paths = [];
        const api = window.electronAPI;

        if (e.dataTransfer.files.length > 0) {
          for (const file of e.dataTransfer.files) {
            // Use Electron webUtils to get the real file path
            const realPath = api && api.getFilePath ? api.getFilePath(file) : '';
            if (realPath) {
              paths.push(realPath);
            } else if (file.size > 0 && api && api.saveTempFile) {
              // No real path (e.g. simulator screenshot) — save to temp
              const buf = await file.arrayBuffer();
              const tmpPath = await api.saveTempFile(buf, file.type, file.name);
              if (tmpPath) paths.push(tmpPath);
            }
          }
        }

        if (paths.length > 0 && tab.termWs && tab.termWs.readyState === WebSocket.OPEN) {
          const quoted = paths.map(p => p.includes(' ') ? `"${p}"` : p);
          tab.termWs.send(JSON.stringify({ type: 'input', data: quoted.join(' ') }));
        }
      } catch (err) {
        console.error('Drop handler error:', err);
      }
    });

    // Window resize
    const resizeHandler = () => {
      if (tab.termFitAddon && tab.el && tab.el.style.display !== 'none') {
        tab.termFitAddon.fit();
      }
    };
    window.addEventListener('resize', resizeHandler);
    tab._resizeHandler = resizeHandler;
  },

  _connectTermWS(tab) {
    // Close existing ws cleanly before reconnecting
    if (tab.termWs) {
      tab.termWs.onclose = null;
      tab.termWs.onerror = null;
      tab.termWs.close();
      tab.termWs = null;
    }

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${wsProtocol}//${location.host}/ws/terminal?cwd=${encodeURIComponent(tab.cwd)}`;
    if (tab.resumeSessionId) {
      wsUrl += `&resume=${encodeURIComponent(tab.resumeSessionId)}`;
    }

    tab.termWs = new WebSocket(wsUrl);

    tab.termWs.onopen = () => {
      this._setTermStatus(tab, true);
      tab.termWs.send(JSON.stringify({
        type: 'resize',
        cols: tab.termInstance.cols,
        rows: tab.termInstance.rows,
      }));
    };

    tab.termWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'output') {
          tab.termInstance.write(msg.data);
        } else if (msg.type === 'replay') {
          // Reattached to existing pty — clear and restore buffered output
          tab.termInstance.clear();
          tab.termInstance.write(msg.data);
        } else if (msg.type === 'session-id') {
          this._showSessionId(tab, msg.sessionId);
        } else if (msg.type === 'exit') {
          this._setTermStatus(tab, false);
          tab.termInstance.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
        }
      } catch {}
    };

    tab.termWs.onclose = () => this._setTermStatus(tab, false);
    tab.termWs.onerror = () => this._setTermStatus(tab, false);
  },

  _setTermStatus(tab, connected) {
    const dot = document.getElementById(`dot-${tab.id}`);
    const text = document.getElementById(`status-${tab.id}`);
    const reconnectBtn = document.getElementById(`reconnect-btn-${tab.id}`);
    if (dot) dot.className = connected ? 'dot' : 'dot disconnected';
    if (text) text.textContent = connected ? 'Connected' : 'Disconnected';
    if (reconnectBtn) reconnectBtn.style.display = connected ? 'none' : 'inline-block';
  },

  _showSessionId(tab, sessionId) {
    const container = document.getElementById(`session-id-${tab.id}`);
    const valEl = document.getElementById(`session-id-val-${tab.id}`);
    const copyBtn = document.getElementById(`session-id-copy-${tab.id}`);
    if (!container || !valEl) return;

    tab.claudeSessionId = sessionId;
    valEl.textContent = sessionId.slice(0, 8) + '...';
    valEl.title = sessionId;
    container.style.display = 'inline-flex';

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(sessionId).then(() => {
        copyBtn.textContent = '\u2713';
        setTimeout(() => { copyBtn.innerHTML = '&#9112;'; }, 1500);
      });
    });
  },

  /** Open a special terminal tab for auth switching */
  openAuthTerminal() {
    const id = 'tab-' + (++this._idCounter);
    const tab = {
      id, title: 'Switch Account', type: 'terminal-auth',
      termInstance: null, termWs: null, termFitAddon: null, el: null,
      _onAuthExit: null,
    };
    this.tabs.push(tab);
    this.renderTabs();
    this.activateTab(id);
    return tab;
  },

  /** Initialize auth terminal (raw shell running auth commands) */
  _initAuthTermInstance(tab) {
    if (typeof Terminal === 'undefined') return;

    const termEl = document.getElementById(`term-${tab.id}`);

    tab.termInstance = new Terminal({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39d2c0',
        white: '#b1bac4',
      },
      fontSize: 14,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', monospace",
      cursorBlink: true,
      scrollback: 5000,
    });

    tab.termFitAddon = new FitAddon.FitAddon();
    tab.termInstance.loadAddon(tab.termFitAddon);
    tab.termInstance.open(termEl);
    tab.termFitAddon.fit();

    // WebSocket — use special auth mode
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${location.host}/ws/terminal?mode=auth`;

    tab.termWs = new WebSocket(wsUrl);

    tab.termWs.onopen = () => {
      this._setTermStatus(tab, true);
    };

    tab.termWs.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'output') {
          tab.termInstance.write(msg.data);
        } else if (msg.type === 'exit') {
          this._setTermStatus(tab, false);
          tab.termInstance.write('\r\n\x1b[33m[Auth process completed]\x1b[0m\r\n');
          // Trigger account refresh callback
          if (tab._onAuthExit) tab._onAuthExit();
        }
      } catch {}
    };

    tab.termWs.onclose = () => this._setTermStatus(tab, false);
    tab.termWs.onerror = () => this._setTermStatus(tab, false);

    // Input
    tab.termInstance.onData((data) => {
      if (tab.termWs && tab.termWs.readyState === WebSocket.OPEN) {
        tab.termWs.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Resize
    tab.termInstance.onResize(({ cols, rows }) => {
      if (tab.termWs && tab.termWs.readyState === WebSocket.OPEN) {
        tab.termWs.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    const resizeHandler = () => {
      if (tab.termFitAddon && tab.el && tab.el.style.display !== 'none') {
        tab.termFitAddon.fit();
      }
    };
    window.addEventListener('resize', resizeHandler);
    tab._resizeHandler = resizeHandler;
  },

  /** Check if any tabs are open */
  hasTabs() {
    return this.tabs.length > 0;
  },
};
