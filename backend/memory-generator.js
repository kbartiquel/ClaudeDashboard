const fs = require('fs');
const path = require('path');
const config = require('./config');

// Max chars extracted per session (~2K tokens)
const MAX_SESSION_CHARS = 8000;
// Max total chars sent to Claude (~20K tokens, leaving room for prompt + response)
const MAX_TOTAL_CHARS = 80000;

/**
 * Extract readable human/assistant text from a JSONL session file.
 * Skips tool_use/tool_result blocks to keep token count manageable.
 */
function extractSessionText(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const messages = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }

      if (entry.isSidechain) continue;
      if (entry.type !== 'user' && entry.type !== 'assistant') continue;
      if (!entry.message) continue;

      const role = entry.message.role;
      const rawContent = entry.message.content;
      let text = '';

      if (typeof rawContent === 'string') {
        text = rawContent;
      } else if (Array.isArray(rawContent)) {
        text = rawContent
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n');
      }

      if (text.trim()) {
        messages.push(`${role.toUpperCase()}: ${text.trim()}`);
      }
    }

    const fullText = messages.join('\n\n');
    if (fullText.length > MAX_SESSION_CHARS) {
      return fullText.slice(0, MAX_SESSION_CHARS) + '\n... [truncated]';
    }
    return fullText;
  } catch {
    return '';
  }
}

/**
 * Read all sessions for a project and combine into a single text block.
 * Sessions are ordered oldest-first so context builds naturally.
 */
function readProjectSessionsText(dirName) {
  const projectsDir = config.load().claudeProjectsDir;
  const dirPath = path.join(projectsDir, dirName);

  if (!fs.existsSync(dirPath)) return '';

  const jsonlFiles = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(dirPath, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime)
    .map(f => f.name);

  let combined = '';
  let sessionCount = 0;

  for (const file of jsonlFiles) {
    const sessionText = extractSessionText(path.join(dirPath, file));
    if (!sessionText) continue;

    const header = `\n\n=== SESSION ${++sessionCount} (${path.basename(file, '.jsonl').slice(0, 8)}...) ===\n`;
    const block = header + sessionText;

    if (combined.length + block.length > MAX_TOTAL_CHARS) {
      const remaining = MAX_TOTAL_CHARS - combined.length - header.length;
      if (remaining > 500) {
        combined += header + sessionText.slice(0, remaining) + '\n... [truncated — token limit reached]';
      }
      break;
    }

    combined += block;
  }

  return combined;
}

/**
 * Get the path to CLAUDE.md for a project
 */
function getClaudeMdPath(dirName) {
  const projectsDir = config.load().claudeProjectsDir;
  return path.join(projectsDir, dirName, 'CLAUDE.md');
}

/**
 * Read existing CLAUDE.md — returns null if it doesn't exist
 */
function readClaudeMd(dirName) {
  const filePath = getClaudeMdPath(dirName);
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf-8');
  }
  return null;
}

/**
 * Write CLAUDE.md for a project
 */
function writeClaudeMd(dirName, content) {
  const filePath = getClaudeMdPath(dirName);
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Call the Claude API to generate or update a CLAUDE.md from session history.
 * @param {string} dirName - Project directory name (encoded)
 * @param {string} projectName - Human-readable project name
 * @param {boolean} merge - If true, merge into existing CLAUDE.md instead of replacing
 */
async function generateMemory(dirName, projectName, merge = false) {
  // Prefer env var, fall back to saved config key
  const apiKey = process.env.ANTHROPIC_API_KEY || config.load().anthropicApiKey;
  if (!apiKey) {
    throw new Error('No Anthropic API key found. Add one in Settings.');
  }

  const sessionText = readProjectSessionsText(dirName);
  if (!sessionText.trim()) {
    throw new Error('No readable session data found for this project.');
  }

  const existingMemory = readClaudeMd(dirName);

  let userPrompt;

  if (merge && existingMemory) {
    userPrompt = `You are maintaining a CLAUDE.md project memory file for Claude Code.

The project is: "${projectName}"

Here is the existing CLAUDE.md:

<existing_memory>
${existingMemory}
</existing_memory>

Here are the conversation sessions to incorporate:

<sessions>
${sessionText}
</sessions>

Update the CLAUDE.md by merging any new information from the sessions into the existing memory. Preserve all still-relevant content. Add new decisions, patterns, features, fixes, or context from the sessions. Remove anything clearly outdated or superseded.

Return ONLY the updated CLAUDE.md markdown — no preamble or explanation.`;
  } else {
    userPrompt = `You are creating a CLAUDE.md project memory file for Claude Code.

The project is: "${projectName}"

Here are the conversation sessions from this project:

<sessions>
${sessionText}
</sessions>

Extract all important context and write a well-organized CLAUDE.md. Include:
- Project purpose and business context
- Tech stack and architecture
- Key files and their roles
- Important patterns, conventions, and decisions made
- Completed features and their current status
- In-progress or planned work
- Known bugs/quirks and fixes applied
- User preferences and workflow conventions

Be thorough but concise. Use markdown headers and bullet points. This file is automatically loaded at the start of every Claude Code session for this project, so it should read like a useful briefing for a developer picking up the project.

Return ONLY the CLAUDE.md markdown — no preamble or explanation.`;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error('Empty response from Claude API.');

  return content;
}

module.exports = {
  readClaudeMd,
  writeClaudeMd,
  generateMemory,
};
