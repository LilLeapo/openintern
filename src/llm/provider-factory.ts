import type { AppConfig } from "../config/schema.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import type { LLMProvider } from "./provider.js";

export function makeProvider(config: AppConfig): LLMProvider {
  const model = config.agents.defaults.model;
  const provider = config.providers.openaiCompatible;

  if (!provider.apiKey) {
    throw new Error(
      "No API key configured. Set providers.openaiCompatible.apiKey in ~/.openintern/config.json",
    );
  }

  return new OpenAICompatibleProvider({
    apiKey: provider.apiKey,
    apiBase: provider.apiBase,
    defaultModel: model,
    extraHeaders: provider.extraHeaders,
  });
}

