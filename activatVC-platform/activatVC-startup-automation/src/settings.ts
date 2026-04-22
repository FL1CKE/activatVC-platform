import fs from 'fs';
import path from 'path';

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'vertex_ai';

export interface LLMSettings {
  provider: LLMProvider | null;
  model: string | null;
  apiKey: string | null;
  agentPrompts: Record<string, string>;
}

const SETTINGS_FILE = path.join(process.cwd(), 'storage', 'llm-settings.json');

function ensureStorageDir(): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadSettings(): LLMSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { provider: null, model: null, apiKey: null, agentPrompts: {} };
    }
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw) as Partial<LLMSettings>;
    return {
      provider: data.provider ?? null,
      model: data.model ?? null,
      apiKey: data.apiKey ?? null,
      agentPrompts: data.agentPrompts ?? {},
    };
  } catch {
    return { provider: null, model: null, apiKey: null, agentPrompts: {} };
  }
}

export function saveSettings(settings: LLMSettings): void {
  ensureStorageDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

export function hasLLMConfig(): boolean {
  const s = loadSettings();
  return Boolean(s.provider && s.model && s.apiKey);
}

export function getLLMConfig(): { provider: LLMProvider; model: string; apiKey: string } | null {
  const s = loadSettings();
  if (!s.provider || !s.model || !s.apiKey) return null;
  return { provider: s.provider, model: s.model, apiKey: s.apiKey };
}

// ─── Prompt helpers ────────────────────────────────────────────────────────────
// Single source of truth: agents_platform PostgreSQL DB.
// llm-settings.json stores local overrides that are synced to agents_platform.

export function getAgentPrompt(agentName: string): string {
  const s = loadSettings();
  return s.agentPrompts[agentName] || `[Prompt managed in agents_platform for ${agentName}]`;
}

export function defaultPromptFor(agentName: string): string {
  return `[Prompt managed in agents_platform for ${agentName}]`;
}

export function listDefaultPrompts(): Record<string, string> {
  const agents = ['CMO+CCO', 'CLO', 'CFO', 'CPO+CTO', 'CHRO'];
  const result: Record<string, string> = {};
  for (const name of agents) {
    result[name] = defaultPromptFor(name);
  }
  return result;
}

/**
 * Get the master orchestrator prompt. Priority: llm-settings.json → null.
 * Returns null if no override exists.
 */
export function getMasterOrchestratorPrompt(): string | null {
  const s = loadSettings();
  if (s.agentPrompts['__orchestrator__']) return s.agentPrompts['__orchestrator__'];
  return null;
}
