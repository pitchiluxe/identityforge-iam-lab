/**
 * ui/aiState.ts — whether the local model is answering, and which one to use.
 */
import { type ModelInfo, defaultModel, listModels } from '../ai/ollama.ts';
import { notify, persist, store } from './store.ts';

export const ai = {
  status: 'checking' as 'checking' | 'online' | 'offline',
  models: [] as ModelInfo[],
  get model(): string | null {
    const chosen = store.settings.model;
    if (chosen && this.models.some((m) => m.name === chosen)) return chosen;
    return defaultModel(this.models);
  },
};

export async function refreshAi(): Promise<void> {
  if (store.settings.system?.localAi === false) {
    ai.models = [];
    ai.status = 'offline';
    notify();
    return;
  }
  ai.status = 'checking';
  notify();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 8000);
    ai.models = await listModels(ctl.signal);
    clearTimeout(t);
    ai.status = ai.models.length ? 'online' : 'offline';
  } catch {
    ai.models = [];
    ai.status = 'offline';
  }
  notify();
}

export function chooseModel(name: string | null): void {
  store.settings.model = name;
  persist();
  notify();
}
