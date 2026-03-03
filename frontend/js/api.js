/**
 * API wrapper for backend calls
 */
const API = {
  async get(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },

  async put(url, data) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },

  async del(url) {
    const res = await fetch(url, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return res.json();
  },

  dashboard()           { return this.get('/api/dashboard'); },
  projects(refresh)     { return this.get('/api/projects' + (refresh ? '?refresh=true' : '')); },
  project(id)           { return this.get(`/api/projects/${encodeURIComponent(id)}`); },
  projectMemory(id)     { return this.get(`/api/projects/${encodeURIComponent(id)}/memory`); },
  conversation(pid, sid){ return this.get(`/api/conversations/${encodeURIComponent(pid)}/${sid}`); },
  search(q, project)    { return this.get(`/api/search?q=${encodeURIComponent(q)}${project ? '&project=' + encodeURIComponent(project) : ''}`); },
  settings()            { return this.get('/api/settings'); },
  updateSettings(data)  { return this.put('/api/settings', data); },
  terminalSessions()    { return this.get('/api/terminal/sessions'); },
  resumableSessions()   { return this.get('/api/terminal/resumable'); },
  killTerminal(id)      { return this.del(`/api/terminal/sessions/${id}`); },
  renameConversation(pid, sid, name) { return this.put(`/api/conversations/${encodeURIComponent(pid)}/${sid}/name`, { name }); },
  syncMemory(pid) { return fetch(`/api/projects/${encodeURIComponent(pid)}/sync-memory`, { method: 'POST' }).then(r => r.json()); },
};
