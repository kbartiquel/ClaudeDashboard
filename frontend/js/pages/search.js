/**
 * Search results page
 */
const SearchPage = {
  async render(container, params) {
    const query = params.get('q') || '';

    container.innerHTML = `
      <div class="page-header">
        <h1>Search Results</h1>
        <p class="subtitle" id="search-subtitle">${query ? `Searching for "${escapeHtml(query)}"...` : 'Enter a search query'}</p>
      </div>
      <div id="search-results" class="conversation-list">
        ${query ? '<div class="loading-container"><div class="spinner"></div></div>' : ''}
      </div>
    `;

    // Update search input
    const searchInput = document.getElementById('global-search');
    if (searchInput) searchInput.value = query;

    if (!query) return;

    try {
      const data = await API.search(query);
      const resultsEl = document.getElementById('search-results');
      const subtitle = document.getElementById('search-subtitle');

      subtitle.textContent = `${data.results.length} result${data.results.length !== 1 ? 's' : ''} for "${query}"`;

      if (data.results.length === 0) {
        resultsEl.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
        return;
      }

      resultsEl.innerHTML = data.results.map(r => `
        <a href="#/conversation/${encodeURIComponent(r.projectDirName)}/${r.sessionId}" class="conversation-item">
          <div class="title">${highlightMatch(r.snippet, query)}</div>
          <div class="meta">
            <span>${escapeHtml(r.projectName)}</span>
            <span>${r.type}</span>
            <span>${timeAgo(r.timestamp)}</span>
          </div>
        </a>
      `).join('');
    } catch (err) {
      document.getElementById('search-results').innerHTML =
        `<div class="empty-state"><p>Error: ${escapeHtml(err.message)}</p></div>`;
    }
  },
};

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  const queryEscaped = escapeHtml(query);
  const regex = new RegExp(`(${queryEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark style="background:var(--accent-dim);color:var(--accent);padding:1px 2px;border-radius:2px;">$1</mark>');
}
