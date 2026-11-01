// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
// The agent's model engine: an OpenAI-compatible endpoint driven through the Responses API,
// because Curbside's agent must see photos inside tool results, and the framework's default for
// a custom endpoint (Chat Completions) can only carry them as text. The UI shows one alias.
import {
  createAISDKEngine,
  registerAgentEngine,
} from "@agent-native/core/agent/engine";
import { defineNitroPlugin } from "@agent-native/core/server";

export const ENGINE_NAME = "curbside-vision";
export const MODEL_ALIAS = "curbside-vision";

/** Swap the public alias for the deployment's real model id on the way out. */
function aliasFetch(realModel: string): typeof fetch {
  return async (input, init) => {
    if (init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body) as { model?: string };
        if (body.model === MODEL_ALIAS) {
          body.model = realModel;
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // Not JSON: pass through untouched.
      }
    }
    return fetch(input, init);
  };
}

export default defineNitroPlugin(() => {
  // LLM inference keys are the framework's app-owned exception to scoped credentials.
  const apiKey = process.env.OPENAI_API_KEY; // guard:allow-env-credential — app-owned inference key
  const baseUrl = process.env.OPENAI_BASE_URL; // guard:allow-env-credential — endpoint URL for that key
  const realModel = process.env.CURBSIDE_MODEL; // guard:allow-env-credential — model id, not a credential
  if (!apiKey || !baseUrl || !realModel) return;
  registerAgentEngine({
    name: ENGINE_NAME,
    label: "Curbside vision agent",
    description: "Reads street photos and drafts map edits.",
    capabilities: {
      thinking: true,
      promptCaching: false,
      vision: true,
      computerUse: false,
      parallelToolCalls: true,
    },
    defaultModel: MODEL_ALIAS,
    supportedModels: [MODEL_ALIAS],
    acceptsCustomModels: false,
    requiredEnvVars: ["OPENAI_API_KEY"],
    create: (config) =>
      createAISDKEngine("openai", {
        ...config,
        name: ENGINE_NAME,
        label: "Curbside vision agent",
        model: MODEL_ALIAS,
        supportedModels: [MODEL_ALIAS],
        acceptsCustomModels: false,
        apiKey,
        allowEnvFallback: false,
        baseUrl,
        forceResponses: true,
        requestFetch: aliasFetch(realModel),
      }),
  });
});
