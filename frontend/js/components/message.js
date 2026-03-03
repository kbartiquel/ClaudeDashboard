/**
 * Message renderer — converts parsed messages to DOM elements
 */
const MessageRenderer = {
  /**
   * Configure marked.js for our use
   */
  initMarked() {
    if (typeof marked === 'undefined') return;

    const renderer = new marked.Renderer();

    // Custom code block rendering
    renderer.code = function({ text, lang }) {
      const wrapper = CodeBlock.render(text, lang);
      const temp = document.createElement('div');
      temp.appendChild(wrapper);
      return temp.innerHTML;
    };

    // Custom inline code
    renderer.codespan = function({ text }) {
      return `<code>${text}</code>`;
    };

    marked.setOptions({
      renderer,
      breaks: true,
      gfm: true,
    });
  },

  /**
   * Render markdown text to HTML
   */
  renderMarkdown(text) {
    if (typeof marked === 'undefined') {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    try {
      return marked.parse(text);
    } catch {
      return text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  },

  /**
   * Format timestamp
   */
  formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      hour12: true,
    });
  },

  /**
   * Render a full message element
   */
  renderMessage(msg) {
    const el = document.createElement('div');
    el.className = `message ${msg.type}`;

    // Header
    const header = document.createElement('div');
    header.className = 'message-header';
    header.innerHTML = `
      <span class="message-role">${msg.type}</span>
      <span class="message-time">${this.formatTime(msg.timestamp)}</span>
    `;
    el.appendChild(header);

    // Content blocks
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.innerHTML = this.renderMarkdown(block.text);
        el.appendChild(bubble);
      } else if (block.type === 'thinking') {
        el.appendChild(this.renderThinking(block.text));
      } else if (block.type === 'tool_use') {
        el.appendChild(this.renderToolUse(block));
      }
    }

    return el;
  },

  /**
   * Render a thinking block (collapsed by default)
   */
  renderThinking(text) {
    const block = document.createElement('div');
    block.className = 'thinking-block';

    const header = document.createElement('div');
    header.className = 'thinking-header';
    header.innerHTML = `
      <span class="thinking-toggle">&#9654;</span>
      <span>Thinking...</span>
    `;
    header.addEventListener('click', () => {
      block.classList.toggle('expanded');
    });

    const content = document.createElement('div');
    content.className = 'thinking-content';
    content.textContent = text;

    block.appendChild(header);
    block.appendChild(content);
    return block;
  },

  /**
   * Render a tool_use block with optional result
   */
  renderToolUse(block) {
    const tool = document.createElement('div');
    tool.className = 'tool-block';

    const hasResult = !!block.result;
    const isError = hasResult && block.result.isError;

    const header = document.createElement('div');
    header.className = 'tool-header';
    header.innerHTML = `
      <span class="tool-toggle">&#9654;</span>
      <span class="tool-name">${block.toolName}</span>
      ${hasResult ? `<span class="tool-result-badge ${isError ? 'error' : 'success'}">${isError ? 'Error' : 'Done'}</span>` : ''}
    `;
    header.addEventListener('click', () => {
      tool.classList.toggle('expanded');
    });

    const body = document.createElement('div');
    body.className = 'tool-body';

    // Input
    if (block.input) {
      const inputSection = document.createElement('div');
      inputSection.className = 'tool-input';
      inputSection.innerHTML = `<div class="tool-section-label">Input</div>`;

      const pre = document.createElement('pre');
      if (typeof block.input === 'string') {
        pre.textContent = block.input;
      } else {
        // For objects, show key fields nicely
        const input = block.input;
        if (block.toolName === 'Bash' && input.command) {
          pre.textContent = input.command;
        } else if (block.toolName === 'Read' && input.file_path) {
          pre.textContent = input.file_path;
        } else if (block.toolName === 'Write' && input.file_path) {
          pre.textContent = `File: ${input.file_path}\n\n${(input.content || '').slice(0, 2000)}${(input.content || '').length > 2000 ? '\n... (truncated)' : ''}`;
        } else if (block.toolName === 'Edit' && input.file_path) {
          pre.textContent = `File: ${input.file_path}\n\nOld:\n${input.old_string || ''}\n\nNew:\n${input.new_string || ''}`;
        } else if (block.toolName === 'Grep' || block.toolName === 'Glob') {
          pre.textContent = JSON.stringify(input, null, 2);
        } else {
          pre.textContent = JSON.stringify(input, null, 2);
        }
      }

      inputSection.appendChild(pre);
      body.appendChild(inputSection);
    }

    // Result
    if (block.result) {
      const resultSection = document.createElement('div');
      resultSection.className = `tool-output ${isError ? 'tool-result-error' : ''}`;
      resultSection.innerHTML = `<div class="tool-section-label">Output</div>`;

      const pre = document.createElement('pre');
      const resultContent = block.result.stdout || block.result.content || '';
      const stderr = block.result.stderr || '';
      let output = '';
      if (typeof resultContent === 'string') {
        output = resultContent;
      } else if (typeof resultContent === 'object') {
        output = JSON.stringify(resultContent, null, 2);
      }
      if (stderr) {
        output += (output ? '\n' : '') + 'STDERR: ' + stderr;
      }
      pre.textContent = output.slice(0, 5000) + (output.length > 5000 ? '\n... (truncated)' : '');

      resultSection.appendChild(pre);
      body.appendChild(resultSection);
    }

    tool.appendChild(header);
    tool.appendChild(body);
    return tool;
  },
};
