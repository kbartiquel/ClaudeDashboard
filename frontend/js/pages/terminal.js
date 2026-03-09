/**
 * Terminal page — xterm.js + WebSocket to node-pty
 */
const TerminalPage = {
  term: null,
  ws: null,
  fitAddon: null,
  _currentCwd: null,
  _currentResumeSessionId: null,

  async render(container, params) {
    const cwd = params.get('cwd') || '';
    const resumeSessionId = params.get('resume') || '';

    container.innerHTML = `
      <div class="terminal-page">
        <div class="page-header" style="margin-bottom:0;">
          <h1>${resumeSessionId ? 'Resume Session' : 'Terminal'}</h1>
          <p class="subtitle">${cwd ? escapeHtml(cwd) : 'Select a project to start'}</p>
        </div>
        <div class="terminal-toolbar">
          ${!cwd ? `
            <select id="terminal-project-select">
              <option value="">Select existing project...</option>
            </select>
            <button class="btn btn-primary" id="terminal-start-btn">Start Claude</button>
          ` : `
            <button class="btn btn-danger btn-sm" id="terminal-disconnect-btn">Disconnect</button>
          `}
        </div>
        ${!cwd ? `
        <div class="section" style="margin-top:8px;">
          <div class="section-title">Or start in any folder</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button class="btn btn-primary" id="browse-dir-btn" style="white-space:nowrap;">Browse Folder...</button>
            <span id="browse-dir-label" style="color:var(--text-muted);font-size:13px;">No folder selected</span>
          </div>
        </div>
        ` : ''}
        <div id="resumable-sessions"></div>
        <div class="terminal-container" id="terminal-el"></div>
        <div class="terminal-status">
          <span class="dot disconnected" id="terminal-dot"></span>
          <span id="terminal-status-text">Disconnected</span>
          <button class="btn btn-sm" id="terminal-reconnect-btn" style="display:none;margin-left:10px;">Reconnect</button>
        </div>
      </div>
    `;

    // If no cwd, load project list for selector + custom dir input
    if (!cwd) {
      await this.loadProjectSelector();
      await this.loadResumableSessions(container);

      const browseBtn = document.getElementById('browse-dir-btn');
      if (browseBtn) {
        browseBtn.addEventListener('click', async () => {
          if (window.electronAPI && window.electronAPI.pickFolder) {
            const dir = await window.electronAPI.pickFolder();
            if (dir) {
              window.location.hash = `#/terminal?cwd=${encodeURIComponent(dir)}`;
            }
          }
        });
      }
      return;
    }

    this._currentCwd = cwd;
    this._currentResumeSessionId = resumeSessionId;
    this.initTerminal(cwd, resumeSessionId);
  },

  async loadProjectSelector() {
    const select = document.getElementById('terminal-project-select');
    if (!select) return;
    try {
      const projects = await API.projects();
      for (const p of projects) {
        const opt = document.createElement('option');
        opt.value = p.cwd;
        opt.textContent = `${p.name} — ${p.cwd}`;
        select.appendChild(opt);
      }
    } catch { /* ignore */ }

    const startBtn = document.getElementById('terminal-start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        const selectedCwd = select.value;
        if (selectedCwd) {
          window.location.hash = `#/terminal?cwd=${encodeURIComponent(selectedCwd)}`;
        }
      });
    }
  },

  async loadResumableSessions(container) {
    try {
      const sessions = await API.resumableSessions();
      const el = document.getElementById('resumable-sessions');
      if (!el || sessions.length === 0) return;

      el.innerHTML = `
        <div class="section" style="margin-top:16px;">
          <div class="section-title">Resumable Sessions</div>
          ${sessions.map(s => `
            <div class="resume-session-item">
              <div>
                <div class="info">Session from ${new Date(s.createdAt).toLocaleString()}</div>
                <div class="path">${escapeHtml(s.projectPath)}</div>
              </div>
              <button class="btn btn-sm btn-primary" onclick="window.location.hash='#/terminal?cwd=${encodeURIComponent(s.projectPath)}&resume=${s.claudeSessionId || ''}'">Resume</button>
            </div>
          `).join('')}
        </div>
      `;
    } catch { /* ignore */ }
  },

  initTerminal(cwd, resumeSessionId) {
    if (typeof Terminal === 'undefined') {
      document.getElementById('terminal-el').innerHTML =
        '<div class="empty-state"><p>Terminal libraries not loaded</p></div>';
      return;
    }

    this.cleanup();

    const termEl = document.getElementById('terminal-el');

    this.term = new Terminal({
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

    this.fitAddon = new FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);

    if (typeof WebLinksAddon !== 'undefined') {
      this.term.loadAddon(new WebLinksAddon.WebLinksAddon());
    }

    this.term.open(termEl);
    this.fitAddon.fit();

    this._connectWS(cwd, resumeSessionId);

    // Send input to pty
    this.term.onData((data) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle resize
    this.term.onResize(({ cols, rows }) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    // Fit on window resize
    this._resizeHandler = () => {
      if (this.fitAddon) this.fitAddon.fit();
    };
    window.addEventListener('resize', this._resizeHandler);

    // Disconnect button
    const disconnectBtn = document.getElementById('terminal-disconnect-btn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => {
        this.cleanup();
        window.location.hash = '#/terminal';
      });
    }

    // Reconnect button
    const reconnectBtn = document.getElementById('terminal-reconnect-btn');
    if (reconnectBtn) {
      reconnectBtn.addEventListener('click', () => {
        this._connectWS(this._currentCwd, this._currentResumeSessionId);
      });
    }
  },

  _connectWS(cwd, resumeSessionId) {
    // Close any existing ws first
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let wsUrl = `${wsProtocol}//${location.host}/ws/terminal?cwd=${encodeURIComponent(cwd)}`;
    if (resumeSessionId) {
      wsUrl += `&resume=${encodeURIComponent(resumeSessionId)}`;
    }

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.setStatus(true);
      this.ws.send(JSON.stringify({
        type: 'resize',
        cols: this.term.cols,
        rows: this.term.rows,
      }));
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'output') {
          this.term.write(msg.data);
        } else if (msg.type === 'replay') {
          // Server is reattaching — clear and replay buffered output
          this.term.clear();
          this.term.write(msg.data);
        } else if (msg.type === 'exit') {
          this.setStatus(false);
          this.term.write('\r\n\x1b[33m[Process exited]\x1b[0m\r\n');
        }
      } catch { /* ignore */ }
    };

    this.ws.onclose = () => {
      this.setStatus(false);
    };

    this.ws.onerror = () => {
      this.setStatus(false);
    };
  },

  setStatus(connected) {
    const dot = document.getElementById('terminal-dot');
    const text = document.getElementById('terminal-status-text');
    const reconnectBtn = document.getElementById('terminal-reconnect-btn');
    if (dot) dot.className = connected ? 'dot' : 'dot disconnected';
    if (text) text.textContent = connected ? 'Connected' : 'Disconnected';
    if (reconnectBtn) reconnectBtn.style.display = connected ? 'none' : 'inline-block';
  },

  cleanup() {
    this._currentCwd = null;
    this._currentResumeSessionId = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.term) {
      this.term.dispose();
      this.term = null;
    }
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    this.fitAddon = null;
  },
};
