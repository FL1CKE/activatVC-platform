import { useEffect, useState, useCallback } from "react";

const API = "";

type Provider = "anthropic" | "openai" | "google" | "vertex_ai";

interface ModelOption {
  id: string;
  label: string;
}

interface AgentPromptEntry {
  prompt: string;
  isCustom: boolean;
  syncedToAgentsPlatform?: boolean;
}

const AGENT_NAMES = ["CMO+CCO", "CLO", "CFO", "CPO+CTO", "CHRO"] as const;

const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI Studio",
  vertex_ai: "Google Vertex AI",
};

const PROVIDER_COLORS: Record<Provider, string> = {
  anthropic: "bg-orange-500 text-white",
  openai: "bg-emerald-600 text-white",
  google: "bg-blue-600 text-white",
  vertex_ai: "bg-indigo-600 text-white",
};

const TEMPLATE_VARS = [
  "{startupName}",
  "{startupStage}",
  "{activityType}",
  "{description}",
  "{businessModel}",
  "{financialSummary}",
  "{investmentAmount}",
  "{currency}",
  "{websiteUrl}",
  "{founders}",
  "{documentIndex}",
];

export default function SettingsPage() {
  // ─── LLM Config State ─────────────────────────────────────────────────────
  const [provider, setProvider] = useState<Provider | null>(null);
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [savedProvider, setSavedProvider] = useState<Provider | null>(null);
  const [savedModel, setSavedModel] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  const [savingLLM, setSavingLLM] = useState(false);
  const [saveLLMResult, setSaveLLMResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [llmSyncResult, setLlmSyncResult] = useState<{ synced: boolean; syncError?: string } | null>(null);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);

  // ─── Agent Prompts State ───────────────────────────────────────────────────
  const [activeAgent, setActiveAgent] = useState<typeof AGENT_NAMES[number]>("CMO+CCO");
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [promptMeta, setPromptMeta] = useState<Record<string, AgentPromptEntry>>({});
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptSaveResult, setPromptSaveResult] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const [promptSyncResult, setPromptSyncResult] = useState<Record<string, { synced: boolean; syncError?: string }>>({});;

  // ─── Load current settings ─────────────────────────────────────────────────
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/admin/settings`);
      const data = await res.json() as {
        provider: Provider | null;
        model: string | null;
        hasApiKey: boolean;
        agentPrompts: Record<string, string>;
      };
      setSavedProvider(data.provider);
      setSavedModel(data.model || "");
      setHasApiKey(data.hasApiKey);
      if (data.provider) setProvider(data.provider);
      if (data.model) setModel(data.model);
    } catch {
      // ignore
    }
  }, []);

  const loadAgentPrompts = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/admin/agents/prompts`);
      const data = await res.json() as Record<string, AgentPromptEntry>;
      setPromptMeta(data);
      const drafts: Record<string, string> = {};
      for (const name of AGENT_NAMES) {
        drafts[name] = data[name]?.prompt || "";
      }
      setPromptDrafts(drafts);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadAgentPrompts();
  }, [loadSettings, loadAgentPrompts]);

  // ─── Clear models when provider changes (user must click Fetch Models) ───
  useEffect(() => {
    setModels([]);
  }, [provider]);

  // ─── Handlers ─────────────────────────────────────────────────────────────
  async function handleSaveLLM() {
    if (!provider || !model || !apiKey) return;
    setSavingLLM(true);
    setSaveLLMResult(null);
    setLlmSyncResult(null);
    try {
      const res = await fetch(`${API}/api/admin/settings/llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, apiKey }),
      });
      if (res.ok) {
        const d = await res.json() as { ok: boolean; synced?: boolean; syncError?: string };
        setSaveLLMResult({ ok: true, msg: "Saved successfully." });
        setSavedProvider(provider);
        setSavedModel(model);
        setHasApiKey(true);
        setApiKey("");
        setLlmSyncResult({ synced: d.synced ?? false, syncError: d.syncError });
      } else {
        const d = await res.json() as { error?: string };
        setSaveLLMResult({ ok: false, msg: d.error || "Save failed." });
      }
    } catch (err) {
      setSaveLLMResult({ ok: false, msg: String(err) });
    } finally {
      setSavingLLM(false);
    }
  }

  async function handleFetchModels() {
    if (!provider || !apiKey) return;
    setFetchingModels(true);
    setFetchModelsError(null);
    try {
      const res = await fetch(`${API}/api/admin/settings/models/fetch?provider=${provider}&apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json() as ModelOption[] | { error?: string };
      if (!res.ok || 'error' in data) {
        setFetchModelsError((data as { error?: string }).error || 'Failed to fetch models');
      } else {
        setModels(data as ModelOption[]);
        if ((data as ModelOption[]).length > 0 && !(data as ModelOption[]).find((m) => m.id === model)) {
          setModel((data as ModelOption[])[0].id);
        }
      }
    } catch (err) {
      setFetchModelsError(String(err));
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleTestConnection() {
    if (!provider || !model || !apiKey) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API}/api/admin/settings/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, apiKey }),
      });
      const data = await res.json() as { ok: boolean; latencyMs?: number; error?: string };
      setTestResult(data);
    } catch (err) {
      setTestResult({ ok: false, error: String(err) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSavePrompt(agentName: string) {
    const prompt = promptDrafts[agentName];
    if (prompt === undefined) return;
    setSavingPrompt(true);
    setPromptSaveResult((prev) => ({ ...prev, [agentName]: { ok: false, msg: "" } }));
    setPromptSyncResult((prev) => ({ ...prev, [agentName]: { synced: false } }));
    try {
      const res = await fetch(`${API}/api/admin/agents/${encodeURIComponent(agentName)}/prompt`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (res.ok) {
        const d = await res.json() as { ok: boolean; synced?: boolean; syncError?: string };
        setPromptSaveResult((prev) => ({ ...prev, [agentName]: { ok: true, msg: "Saved." } }));
        setPromptMeta((prev) => ({ ...prev, [agentName]: { prompt, isCustom: true } }));
        setPromptSyncResult((prev) => ({ ...prev, [agentName]: { synced: d.synced ?? false, syncError: d.syncError } }));
      } else {
        const d = await res.json() as { error?: string };
        setPromptSaveResult((prev) => ({ ...prev, [agentName]: { ok: false, msg: d.error || "Failed." } }));
      }
    } catch (err) {
      setPromptSaveResult((prev) => ({ ...prev, [agentName]: { ok: false, msg: String(err) } }));
    } finally {
      setSavingPrompt(false);
    }
  }

  async function handleResetPrompt(agentName: string) {
    try {
      const res = await fetch(`${API}/api/admin/agents/${encodeURIComponent(agentName)}/prompt`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json() as { prompt: string; synced?: boolean; syncError?: string };
        setPromptDrafts((prev) => ({ ...prev, [agentName]: data.prompt }));
        setPromptMeta((prev) => ({ ...prev, [agentName]: { prompt: data.prompt, isCustom: false } }));
        setPromptSaveResult((prev) => ({ ...prev, [agentName]: { ok: true, msg: "Reset to default." } }));
        setPromptSyncResult((prev) => ({ ...prev, [agentName]: { synced: data.synced ?? false, syncError: data.syncError } }));
      }
    } catch {
      // ignore
    }
  }

  const isDirty = (agentName: string) => promptDrafts[agentName] !== promptMeta[agentName]?.prompt;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-4xl space-y-10">
        {/* Header */}
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Activat VC / Admin</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-900">AI Agent Settings</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configure LLM provider and per-agent system prompts. Changes take effect on the next submission.
          </p>
        </div>

        {/* ── LLM Configuration ─────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">LLM Provider</h2>
          <p className="mb-5 text-sm text-slate-500">
            Select provider, paste your API key and choose a model. The key is stored locally on the server.
          </p>

          {/* Current status */}
          {savedProvider && (
            <div className="mb-5 flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PROVIDER_COLORS[savedProvider]}`}>
                {PROVIDER_LABELS[savedProvider]}
              </span>
              <span className="text-slate-700 font-mono">{savedModel}</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${hasApiKey ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {hasApiKey ? "API key saved" : "No key"}
              </span>
            </div>
          )}

          {/* Provider selector */}
          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Company</label>
            <div className="flex gap-2">
              {(["anthropic", "openai", "google", "vertex_ai"] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => { setProvider(p); setTestResult(null); setSaveLLMResult(null); }}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                    provider === p
                      ? `${PROVIDER_COLORS[p]} border-transparent shadow`
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* API key input + Fetch Models */}
          {provider && (
            <div className="mb-5">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                API Key
                <span className="ml-2 text-xs font-normal text-slate-400">(paste — stored only on server)</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasApiKey ? "••••••••••••  (re-paste to update)" : `sk-... or equivalent`}
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
                  autoComplete="off"
                />
                <button
                  onClick={handleFetchModels}
                  disabled={fetchingModels || !apiKey}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap"
                  title="Fetch live model list from provider API"
                >
                  {fetchingModels ? "…" : "↻ Fetch Models"}
                </button>
              </div>
              {fetchModelsError && (
                <p className="mt-1 text-xs text-red-600">{fetchModelsError}</p>
              )}
            </div>
          )}

          {/* Model selector */}
          {provider && models.length > 0 && (
            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Action buttons */}
          {provider && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleTestConnection}
                disabled={testing || !apiKey}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
              >
                {testing ? "Testing…" : "Test Connection"}
              </button>
              <button
                onClick={handleSaveLLM}
                disabled={savingLLM || !apiKey || !model}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
              >
                {savingLLM ? "Saving…" : "Save Configuration"}
              </button>

              {/* Test result */}
              {testResult && (
                <span className={`text-sm font-medium ${testResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                  {testResult.ok
                    ? `✓ Connected (${testResult.latencyMs}ms)`
                    : `✗ ${testResult.error?.slice(0, 80) || "Connection failed"}`}
                </span>
              )}

              {/* Save result */}
              {saveLLMResult && (
                <span className={`text-sm font-medium ${saveLLMResult.ok ? "text-emerald-600" : "text-red-600"}`}>
                  {saveLLMResult.ok ? `✓ ${saveLLMResult.msg}` : `✗ ${saveLLMResult.msg}`}
                </span>
              )}
              {/* Agents-platform sync badge */}
              {saveLLMResult?.ok && llmSyncResult && (
                <span
                  title={llmSyncResult.syncError || "Model synced to all agents in agents_platform"}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    llmSyncResult.synced
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {llmSyncResult.synced ? "✓ Synced to agents_platform" : "⚠ Saved locally (agents_platform unreachable)"}
                </span>
              )}
            </div>
          )}
        </section>

        {/* ── Agent Prompts ──────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-slate-900">Agent System Prompts</h2>
          <p className="mb-5 text-sm text-slate-500">
            Customize the system prompt for each agent. Leave blank to use the built-in default.
          </p>

          {/* Agent tabs */}
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-100 pb-3">
            {AGENT_NAMES.map((name) => (
              <button
                key={name}
                onClick={() => {
                  setActiveAgent(name);
                  setPromptSaveResult((prev) => ({ ...prev, [name]: { ok: false, msg: "" } }));
                }}
                className={`relative rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  activeAgent === name
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {name}
                {isDirty(name) && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
                )}
                {promptMeta[name]?.isCustom && !isDirty(name) && promptSyncResult[name]?.synced && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400" />
                )}
                {promptMeta[name]?.isCustom && !isDirty(name) && !promptSyncResult[name]?.synced && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-blue-400" />
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
              <span><span className="inline-block h-2 w-2 rounded-full bg-amber-400 mr-1" />Unsaved</span>
              <span><span className="inline-block h-2 w-2 rounded-full bg-blue-400 mr-1" />Custom</span>
              <span><span className="inline-block h-2 w-2 rounded-full bg-emerald-400 mr-1" />Synced</span>
            </div>
          </div>

          {/* Template variables hint */}
          <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2">
            <p className="mb-1.5 text-xs font-medium text-slate-500">Available template variables (reference only — not auto-substituted):</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARS.map((v) => (
                <code key={v} className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-600 border border-slate-200">
                  {v}
                </code>
              ))}
            </div>
          </div>

          {/* Prompt textarea */}
          <textarea
            value={promptDrafts[activeAgent] || ""}
            onChange={(e) =>
              setPromptDrafts((prev) => ({ ...prev, [activeAgent]: e.target.value }))
            }
            rows={18}
            spellCheck={false}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-mono text-xs text-slate-800 shadow-sm focus:border-slate-400 focus:outline-none leading-relaxed"
            placeholder="Paste or type the system prompt for this agent…"
          />

          {/* Prompt actions */}
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => handleSavePrompt(activeAgent)}
              disabled={savingPrompt || !isDirty(activeAgent)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40"
            >
              {savingPrompt ? "Saving…" : "Save Prompt"}
            </button>
            <button
              onClick={() => handleResetPrompt(activeAgent)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Reset to Default
            </button>

            {promptSaveResult[activeAgent]?.msg && (
              <span className={`text-sm font-medium ${promptSaveResult[activeAgent].ok ? "text-emerald-600" : "text-red-600"}`}>
                {promptSaveResult[activeAgent].ok
                  ? `✓ ${promptSaveResult[activeAgent].msg}`
                  : `✗ ${promptSaveResult[activeAgent].msg}`}
              </span>
            )}
            {promptSaveResult[activeAgent]?.ok && promptSyncResult[activeAgent] && (
              <span
                title={promptSyncResult[activeAgent].syncError || "Synced to agents_platform"}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  promptSyncResult[activeAgent].synced
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-amber-100 text-amber-700"
                }`}
              >
                {promptSyncResult[activeAgent].synced ? "✓ Synced to agents_platform" : "⚠ Saved locally (agents_platform unreachable)"}
              </span>
            )}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-slate-100 bg-slate-50 px-6 py-5 text-sm text-slate-600 space-y-1.5">
          <p className="font-medium text-slate-800">How it works</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>When a valid API key is saved, all new submissions will use <strong>real LLM calls</strong> instead of mock responses.</li>
            <li>If an LLM call fails mid-analysis, the system automatically falls back to the mock agent and logs the error.</li>
            <li>Prompt changes only affect future submissions — already-running analyses are not affected.</li>
            <li>Use the blue dot indicator to see which agents have custom prompts active. Green dot means the prompt is also synced to agents_platform.</li>
            <li>In <strong>external</strong> mode, saving a prompt automatically pushes it to agents_platform via API — you will see "✓ Synced" or "⚠ Saved locally" after each save.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
