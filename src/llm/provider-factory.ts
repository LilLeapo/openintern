import type { AppConfig } from "../config/schema.js";
import { AnthropicCompatibleProvider } from "./anthropic-compatible-provider.js";
import { OpenAICompatibleProvider } from "./openai-compatible-provider.js";
import type { LLMProvider } from "./provider.js";

function makeOpenAI(config: AppConfig): LLMProvider {
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

function makeAnthropic(config: AppConfig): LLMProvider {
  const model = config.agents.defaults.model;
  const provider = config.providers.anthropicCompatible;
  if (!provider.apiKey) {
    throw new Error(
      "No API key configured. Set providers.anthropicCompatible.apiKey in ~/.openintern/config.json",
    );
  }
  return new AnthropicCompatibleProvider({
    apiKey: provider.apiKey,
    apiBase: provider.apiBase,
    defaultModel: model,
    anthropicVersion: provider.anthropicVersion,
    extraHeaders: provider.extraHeaders,
  });
}

export function makeProvider(config: AppConfig): LLMProvider {
  const forcedProvider = config.agents.defaults.provider;
  if (forcedProvider === "openaiCompatible") {
    return makeOpenAI(config);
  }
  if (forcedProvider === "anthropicCompatible") {
    return makeAnthropic(config);
  }

  const model = config.agents.defaults.model;
  if (model.toLowerCase().includes("claude")) {
    if (config.providers.anthropicCompatible.apiKey) {
      return makeAnthropic(config);
    }
    if (config.providers.openaiCompatible.apiKey) {
      return makeOpenAI(config);
    }
    throw new Error(
      "No API key configured. Set providers.anthropicCompatible.apiKey (recommended for Claude) or providers.openaiCompatible.apiKey.",
    );
  }

  if (config.providers.openaiCompatible.apiKey) {
    return makeOpenAI(config);
  }
  if (config.providers.anthropicCompatible.apiKey) {
    return makeAnthropic(config);
  }
  throw new Error(
    "No API key configured. Set providers.openaiCompatible.apiKey or providers.anthropicCompatible.apiKey in ~/.openintern/config.json",
  );
}
