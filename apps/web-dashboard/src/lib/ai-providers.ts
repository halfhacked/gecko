/**
 * Local extension of @nocoo/next-ai's provider registry.
 *
 * The upstream package ships a fixed set of `BUILTIN_PROVIDERS` and a
 * `isValidProvider` validator. To add new providers (like DeepSeek) without
 * forking the package, this module overlays additional entries on top and
 * provides a translation layer for the server-side resolver: locally-added
 * providers are converted into a "custom" config (baseURL + sdkType) before
 * being handed to `resolveAiConfig`, which only knows about the upstream
 * builtin set plus "custom".
 */

import {
  BUILTIN_PROVIDERS,
  isValidProvider,
  type AiProviderInfo,
  type AiSettingsInput,
  type BuiltinProvider,
} from "@nocoo/next-ai";

const LOCAL_PROVIDERS = {
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    sdkType: "openai",
    models: ["deepseek-v4", "deepseek-chat", "deepseek-reasoner"],
    defaultModel: "deepseek-v4",
  },
} as const satisfies Record<string, AiProviderInfo>;

export type LocalProvider = keyof typeof LOCAL_PROVIDERS;
export type ExtendedBuiltinProvider = BuiltinProvider | LocalProvider;

/** BUILTIN_PROVIDERS overlaid with locally-added entries. */
export const EXTENDED_BUILTIN_PROVIDERS: Record<ExtendedBuiltinProvider, AiProviderInfo> = {
  ...BUILTIN_PROVIDERS,
  ...LOCAL_PROVIDERS,
};

/** Validator that accepts both upstream builtins ("custom" included) and local additions. */
export function isValidExtendedProvider(value: string): boolean {
  return isValidProvider(value) || value in LOCAL_PROVIDERS;
}

/**
 * Translate a settings input so that locally-added providers are presented to
 * the upstream resolver as a "custom" config. Upstream providers pass through
 * unchanged.
 */
export function applyLocalProviderPresets(input: AiSettingsInput): AiSettingsInput {
  const local = LOCAL_PROVIDERS[input.provider as LocalProvider];
  if (!local) return input;
  return {
    ...input,
    provider: "custom",
    baseURL: input.baseURL || local.baseURL,
    sdkType: input.sdkType ?? local.sdkType,
    model: input.model || local.defaultModel,
  };
}
