/**
 * Code block renderer with syntax highlighting and copy button
 */
const CodeBlock = {
  render(code, lang) {
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';

    const header = document.createElement('div');
    header.className = 'code-block-header';
    header.innerHTML = `
      <span class="code-block-lang">${lang || 'text'}</span>
      <button class="code-block-copy" onclick="CodeBlock.copy(this)">Copy</button>
    `;

    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = code;

    if (lang && typeof hljs !== 'undefined') {
      try {
        const highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true });
        codeEl.innerHTML = highlighted.value;
      } catch {
        // Fallback: no highlighting
      }
    }

    pre.appendChild(codeEl);
    wrapper.appendChild(header);
    wrapper.appendChild(pre);

    return wrapper;
  },

  copy(btn) {
    const code = btn.closest('.code-block-wrapper').querySelector('code');
    navigator.clipboard.writeText(code.textContent).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  },
};
