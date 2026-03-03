/**
 * Conversation viewer page — full chat with formatted messages
 */
const ConversationPage = {
  async render(container, projectId, sessionId) {
    container.innerHTML = `
      <div class="breadcrumb">
        <a href="#/projects">Projects</a>
        <span class="sep">/</span>
        <a href="#/project/${encodeURIComponent(projectId)}" id="conv-project-link">Project</a>
        <span class="sep">/</span>
        <span>Conversation</span>
      </div>
      <div class="page-header">
        <h1 id="conv-title">Conversation</h1>
        <p class="subtitle" id="conv-meta"></p>
      </div>
      <div style="margin-bottom:16px;display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary" id="resume-conv-btn">&#9002; Resume in Terminal</button>
        <button class="btn" id="resume-ext-btn">&#8599; Resume in External Terminal</button>
        <button class="btn" id="rename-conv-btn">&#9998; Rename</button>
      </div>
      <div id="chat-container" class="chat-container">
        <div class="loading-container"><div class="spinner"></div></div>
      </div>
    `;

    try {
      MessageRenderer.initMarked();

      const data = await API.conversation(projectId, sessionId);
      const chatEl = document.getElementById('chat-container');
      chatEl.innerHTML = '';

      if (!data.messages || data.messages.length === 0) {
        chatEl.innerHTML = '<div class="empty-state"><p>No messages in this conversation</p></div>';
        return;
      }

      // Set title from first user message
      const firstUser = data.messages.find(m => m.type === 'user');
      if (firstUser) {
        const firstText = firstUser.content.find(b => b.type === 'text');
        if (firstText) {
          document.getElementById('conv-title').textContent = firstText.text.slice(0, 100);
        }
      }

      // Meta info
      document.getElementById('conv-meta').textContent =
        `${data.messages.length} messages | Session: ${sessionId.slice(0, 8)}...`;

      // Resume in dashboard terminal tab
      document.getElementById('resume-conv-btn').addEventListener('click', () => {
        const cwd = data.cwd || '';
        const name = cwd.split('/').filter(Boolean).pop() || 'Session';
        TabManager.openTerminal(name + ' (resume)', cwd, sessionId, projectId);
      });

      // Resume in external Terminal.app
      document.getElementById('resume-ext-btn').addEventListener('click', () => {
        const cwd = data.cwd || '';
        if (window.electronAPI && window.electronAPI.openExternalTerminal) {
          window.electronAPI.openExternalTerminal(cwd, sessionId);
        }
      });

      // Rename conversation (custom dialog since prompt() doesn't work in Electron)
      document.getElementById('rename-conv-btn').addEventListener('click', () => {
        const currentTitle = document.getElementById('conv-title').textContent;
        // Create inline rename dialog
        const overlay = document.createElement('div');
        overlay.className = 'rename-overlay';
        overlay.innerHTML = `
          <div class="rename-dialog">
            <div style="font-weight:600;margin-bottom:12px;">Rename Conversation</div>
            <input type="text" id="rename-input" class="rename-input" value="${escapeHtml(currentTitle)}" />
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
              <button class="btn" id="rename-cancel">Cancel</button>
              <button class="btn btn-primary" id="rename-save">Save</button>
            </div>
          </div>
        `;
        document.body.appendChild(overlay);

        const input = document.getElementById('rename-input');
        input.focus();
        input.select();

        const close = () => overlay.remove();
        const save = async () => {
          const val = input.value.trim();
          if (val) {
            await API.renameConversation(projectId, sessionId, val);
            document.getElementById('conv-title').textContent = val;
          }
          close();
        };

        document.getElementById('rename-cancel').addEventListener('click', close);
        document.getElementById('rename-save').addEventListener('click', save);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') close();
        });
      });

      // Render messages
      for (const msg of data.messages) {
        const msgEl = MessageRenderer.renderMessage(msg);
        chatEl.appendChild(msgEl);
      }

      // Re-highlight any code blocks
      if (typeof hljs !== 'undefined') {
        chatEl.querySelectorAll('pre code:not(.hljs)').forEach(block => {
          hljs.highlightElement(block);
        });
      }
    } catch (err) {
      document.getElementById('chat-container').innerHTML =
        `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }
  },
};
