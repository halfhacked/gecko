# @nocoo/next-ai 包设计方案

## 1. 概述

### 1.1 目标

从 Gecko 项目抽取通用 AI 模块，发布为公开 npm 包 `@nocoo/next-ai`，专为 Next.js 项目设计。

### 1.2 核心特性

- **多 Provider 支持** — 内置 Anthropic、MiniMax、GLM、AIHubMix，支持 URL base 自定义 Provider
- **多模板 Prompt 系统** — 支持注册多种 prompt 模板，变量定义，模板选择器
- **Basalt UI 组件** — 遵循 Basalt 设计规范的 AI 设置面板，依赖 Tailwind CSS
- **Storage Adapter** — 抽象存储层接口，消费方自行实现（附开发环境示例）
- **高层 AI Helpers** — 封装 chat/completion/stream 常用场景
- **Server/Client 分离** — API Key 等敏感数据仅在服务端处理，使用 `server-only` 保护
- **6DQ 测试覆盖** — L1 单元测试 + G1 静态分析 + L2 集成测试

### 1.3 不包含内容

- 具体 Prompt 内容（如 Gecko 的生产力分析 Prompt，应用自行定义）
- 具体业务逻辑（分析、评分等）
- 存储实现（消费方需自行实现 `AiStorageAdapter`，API Key 应存储在服务端）

### 1.4 安全模型

**API Key 存储原则**：
- API Key 是敏感凭证，**必须存储在服务端**（数据库、环境变量等）
- 客户端 UI 只负责输入和展示掩码，真实值通过 HTTPS 提交到服务端
- SDK 不提供任何客户端存储 API Key 的内置实现
- 文档中的 localStorage 示例仅用于开发调试，明确标注**禁止用于生产环境**

---

## 2. 包结构

### 2.1 目录布局

```
next-ai/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── biome.json                   # G1 静态分析配置
├── README.md
├── src/
│   ├── index.ts                 # 主入口：类型 + 常量 + 工具函数
│   ├── server.ts                # 服务端入口：AI 客户端 + Helpers
│   ├── react.ts                 # React 入口：组件 + hooks
│   │
│   ├── core/
│   │   ├── types.ts             # 核心类型定义
│   │   ├── providers.ts         # 内置 Provider 注册表
│   │   ├── registry.ts          # 可扩展 Provider 注册器
│   │   ├── config.ts            # 配置解析逻辑
│   │   ├── templates.ts         # 多模板 Prompt 系统（类型 + 实现）
│   │   └── utils.ts             # 工具函数
│   │
│   ├── server/
│   │   ├── client.ts            # Vercel AI SDK 封装
│   │   ├── helpers.ts           # 高层 AI Helpers（类型 + 实现）
│   │   └── index.ts             # 服务端导出
│   │
│   └── react/
│       ├── context.tsx          # AiConfigProvider
│       ├── hooks.ts             # useAiSettings, useAiTest
│       ├── styles.ts            # Basalt CSS tokens + cn utility
│       ├── components/
│       │   ├── AiSettingsPanel.tsx
│       │   ├── ProviderSelect.tsx
│       │   ├── ModelSelect.tsx
│       │   ├── ApiKeyInput.tsx
│       │   └── PromptTemplateSelector.tsx
│       └── index.ts             # React 导出
│
└── __tests__/
    ├── unit/                    # L1 单元测试
    │   ├── providers.test.ts
    │   ├── config.test.ts
    │   ├── registry.test.ts
    │   ├── templates.test.ts
    │   └── utils.test.ts
    └── integration/             # L2 集成测试
        └── helpers.test.ts
```

### 2.2 三个入口点

| 入口 | 导入路径 | 内容 | 环境 |
|------|----------|------|------|
| 主入口 | `@nocoo/next-ai` | 类型、常量、工具函数 | 通用 |
| 服务端 | `@nocoo/next-ai/server` | AI 客户端创建 | 仅服务端 |
| React | `@nocoo/next-ai/react` | 组件、hooks、Context | 客户端 |

---

## 3. 核心类型定义

### 3.1 Provider 类型

```typescript
// src/core/types.ts

/** SDK 协议类型 */
export type SdkType = "anthropic" | "openai";

/** 内置 Provider ID */
export type BuiltinProvider = "anthropic" | "minimax" | "glm" | "aihubmix";

/** 所有 Provider ID（含 custom） */
export type AiProvider = BuiltinProvider | "custom" | (string & {});

/** Provider 静态配置 */
export interface AiProviderInfo {
  id: string;
  label: string;
  baseURL: string;
  sdkType: SdkType;
  models: string[];
  defaultModel: string;
}

/** 运行时完整配置 */
export interface AiConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  model: string;
  sdkType: SdkType;
}

/** 用户输入的设置（写入存储） */
export interface AiSettingsInput {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  sdkType?: SdkType;
}

/** 从存储读取的设置（读取模型，apiKey 永不返回真实值） */
export interface AiSettingsReadonly {
  provider: string;
  model: string;
  hasApiKey: boolean;      // 是否已设置 API Key
  baseURL?: string;
  sdkType?: SdkType;
  // 注意：不包含 apiKey 字段，避免误传回服务端
}
```

### 3.2 Storage Adapter 接口

```typescript
// src/core/types.ts

/** 测试连接的配置（草稿配置，无需先保存） */
export interface AiTestConfig {
  provider: string;
  apiKey: string;
  model: string;
  baseURL?: string;
  sdkType?: SdkType;
}

/** 存储适配器接口 - 消费方必须实现 */
export interface AiStorageAdapter {
  /** 获取当前设置（读取模型，不含真实 apiKey） */
  getSettings(): Promise<AiSettingsReadonly>;
  
  /** 保存设置（部分更新） */
  saveSettings(settings: Partial<AiSettingsInput>): Promise<AiSettingsReadonly>;
  
  /** 测试 AI 连接（使用草稿配置，无需先保存） */
  testConnection(config: AiTestConfig): Promise<AiTestResult>;
}

export interface AiTestResult {
  success: boolean;
  response?: string;
  model?: string;
  provider?: string;
  error?: string;
}
```

---

## 4. 内置 Provider 注册表

### 4.1 预置 Provider

```typescript
// src/core/providers.ts

export const BUILTIN_PROVIDERS: Record<BuiltinProvider, AiProviderInfo> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    sdkType: "anthropic",
    models: ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"],
    defaultModel: "claude-sonnet-4-20250514",
  },
  minimax: {
    id: "minimax",
    label: "MiniMax",
    baseURL: "https://api.minimaxi.com/anthropic/v1",
    sdkType: "anthropic",
    models: ["MiniMax-M2.5", "MiniMax-M2.1"],
    defaultModel: "MiniMax-M2.5",
  },
  glm: {
    id: "glm",
    label: "GLM (Zhipu)",
    baseURL: "https://open.bigmodel.cn/api/anthropic/v1",
    sdkType: "anthropic",
    models: ["glm-5", "glm-4.7"],
    defaultModel: "glm-5",
  },
  aihubmix: {
    id: "aihubmix",
    label: "AIHubMix",
    baseURL: "https://aihubmix.com/v1",
    sdkType: "openai",
    models: ["gpt-4o-mini", "gpt-5-nano"],
    defaultModel: "gpt-4o-mini",
  },
};

export const CUSTOM_PROVIDER_INFO: Omit<AiProviderInfo, "baseURL" | "sdkType"> = {
  id: "custom",
  label: "Custom",
  models: [],
  defaultModel: "",
};
```

### 4.2 可扩展注册器

```typescript
// src/core/registry.ts

export class AiProviderRegistry {
  private providers: Map<string, AiProviderInfo>;

  constructor(customProviders?: Record<string, AiProviderInfo>) {
    this.providers = new Map(Object.entries(BUILTIN_PROVIDERS));
    if (customProviders) {
      for (const [id, info] of Object.entries(customProviders)) {
        this.providers.set(id, info);
      }
    }
  }

  get(id: string): AiProviderInfo | undefined {
    return this.providers.get(id);
  }

  getAll(): AiProviderInfo[] {
    return Array.from(this.providers.values());
  }

  getAllIds(): string[] {
    return [...this.providers.keys(), "custom"];
  }

  register(info: AiProviderInfo): void {
    this.providers.set(info.id, info);
  }
}

/** 默认注册器实例 */
export const defaultRegistry = new AiProviderRegistry();
```

---

## 5. 配置解析与校验

```typescript
// src/core/config.ts

export interface AiConfigError {
  field: string;
  message: string;
}

/** 校验配置完整性，返回错误列表（空数组表示通过） */
export function validateAiConfig(
  input: Partial<AiSettingsInput>,
  registry: AiProviderRegistry = defaultRegistry
): AiConfigError[] {
  const errors: AiConfigError[] = [];

  // 校验 provider
  if (!input.provider) {
    errors.push({ field: "provider", message: "Provider is required" });
  } else if (input.provider !== "custom" && !registry.get(input.provider)) {
    errors.push({ field: "provider", message: `Unknown provider: ${input.provider}` });
  }

  // 校验 apiKey
  if (!input.apiKey) {
    errors.push({ field: "apiKey", message: "API key is required" });
  }

  // 校验 custom provider 特有字段
  if (input.provider === "custom") {
    if (!input.baseURL) {
      errors.push({ field: "baseURL", message: "Base URL is required for custom provider" });
    }
    if (!input.sdkType) {
      errors.push({ field: "sdkType", message: "SDK type is required for custom provider" });
    }
    if (!input.model) {
      errors.push({ field: "model", message: "Model is required for custom provider" });
    }
  }

  return errors;
}

/** 解析配置（校验通过后调用） */
export function resolveAiConfig(
  input: AiSettingsInput,
  registry: AiProviderRegistry = defaultRegistry
): AiConfig {
  // 先校验
  const errors = validateAiConfig(input, registry);
  if (errors.length > 0) {
    throw new Error(errors.map(e => `${e.field}: ${e.message}`).join("; "));
  }

  const { provider, apiKey, model, baseURL, sdkType } = input;

  if (provider === "custom") {
    return { provider, baseURL: baseURL!, apiKey, model, sdkType: sdkType! };
  }

  const providerInfo = registry.get(provider)!;
  return {
    provider,
    baseURL: providerInfo.baseURL,
    apiKey,
    model: model || providerInfo.defaultModel,
    sdkType: providerInfo.sdkType,
  };
}

export function isValidProvider(
  id: string,
  registry: AiProviderRegistry = defaultRegistry
): boolean {
  return id === "custom" || registry.get(id) !== undefined;
}
```

---

## 6. 服务端模块

```typescript
// src/server/client.ts
import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { AiConfig } from "../core/types";

export function createAiClient(config: AiConfig) {
  const { baseURL, apiKey, sdkType } = config;

  if (sdkType === "openai") {
    return createOpenAI({ baseURL, apiKey });
  }
  return createAnthropic({ baseURL, apiKey });
}

export function createAiModel(config: AiConfig) {
  const client = createAiClient(config);
  return client(config.model);
}
```

---

## 7. React 模块

### 7.1 Context Provider

```typescript
// src/react/context.tsx
"use client";

import { createContext, useContext, useState, useCallback, useEffect } from "react";
import type { 
  AiStorageAdapter, AiSettingsInput, AiSettingsReadonly, AiTestResult, AiTestConfig 
} from "../core/types";
import { AiProviderRegistry, defaultRegistry } from "../core/registry";

interface AiConfigContextValue {
  settings: AiSettingsReadonly | null;
  loading: boolean;
  saving: boolean;
  registry: AiProviderRegistry;
  
  reload: () => Promise<void>;
  save: (updates: Partial<AiSettingsInput>) => Promise<void>;
  testConnection: (config: AiTestConfig) => Promise<AiTestResult>;
}

const AiConfigContext = createContext<AiConfigContextValue | null>(null);

interface AiConfigProviderProps {
  adapter: AiStorageAdapter;
  registry?: AiProviderRegistry;
  children: React.ReactNode;
}

export function AiConfigProvider({ 
  adapter, 
  registry = defaultRegistry, 
  children 
}: AiConfigProviderProps) {
  const [settings, setSettings] = useState<AiSettingsReadonly | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adapter.getSettings();
      setSettings(data);
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  const save = useCallback(async (updates: Partial<AiSettingsInput>) => {
    setSaving(true);
    try {
      const data = await adapter.saveSettings(updates);
      setSettings(data);
    } finally {
      setSaving(false);
    }
  }, [adapter]);

  const testConnection = useCallback((config: AiTestConfig) => {
    return adapter.testConnection(config);
  }, [adapter]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <AiConfigContext.Provider value={{ 
      settings, loading, saving, registry, reload, save, testConnection 
    }}>
      {children}
    </AiConfigContext.Provider>
  );
}

export function useAiConfig() {
  const ctx = useContext(AiConfigContext);
  if (!ctx) throw new Error("useAiConfig must be used within AiConfigProvider");
  return ctx;
}
```

### 7.2 Hooks

```typescript
// src/react/hooks.ts
"use client";

import { useState, useCallback } from "react";
import { useAiConfig } from "./context";
import type { AiTestResult, AiTestConfig } from "../core/types";

export function useAiSettings() {
  const { settings, loading, saving, save, reload } = useAiConfig();
  return { settings, loading, saving, save, reload };
}

export function useAiTest() {
  const { testConnection } = useAiConfig();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);

  const test = useCallback(async (config: AiTestConfig) => {
    setTesting(true);
    setResult(null);
    try {
      const res = await testConnection(config);
      setResult(res);
      return res;
    } finally {
      setTesting(false);
    }
  }, [testConnection]);

  return { test, testing, result };
}

export function useProviderRegistry() {
  const { registry } = useAiConfig();
  return registry;
}
```

### 7.3 组件 API

```typescript
// src/react/components/AiSettingsPanel.tsx
"use client";

export interface AiSettingsPanelProps {
  /** 自定义类名 */
  className?: string;
  /** 保存成功回调 */
  onSaveSuccess?: () => void;
  /** 测试成功回调 */
  onTestSuccess?: (result: AiTestResult) => void;
  /** 测试失败回调 */
  onTestError?: (error: string) => void;
  /** 隐藏测试按钮 */
  hideTestButton?: boolean;
}

export function AiSettingsPanel(props: AiSettingsPanelProps) {
  // 使用 useAiSettings, useAiTest hooks
  // 渲染 Provider 选择、Model 选择、API Key 输入、保存/测试按钮
}
```

---

## 8. 多模板 Prompt 系统

### 8.1 核心概念

SDK 提供完整的多模板管理能力，host 应用可注册多种 prompt 模板，用户可选择使用。

```typescript
// src/core/templates.ts
import { expandTemplate, type TemplateVariables } from "./utils";

/** 模板变量定义 */
export interface TemplateVariable {
  key: string;           // 变量名，如 "date"
  label: string;         // 显示名称，如 "日期"
  description?: string;  // 描述
  example?: string;      // 示例值
  required?: boolean;    // 是否必填，默认 true
}

/** Prompt 模板定义 */
export interface PromptTemplate {
  id: string;            // 唯一标识，如 "daily-analysis"
  name: string;          // 显示名称，如 "每日分析"
  description?: string;  // 模板描述
  sections: PromptSection[];  // 多段式 prompt
  variables: TemplateVariable[];  // 变量定义
}

/** Prompt 段落 */
export interface PromptSection {
  id: string;            // 段落 ID，如 "section1"
  label: string;         // 显示名称，如 "角色设定"
  content: string;       // 模板内容，含 {{variable}}
  editable?: boolean;    // 用户是否可编辑，默认 true
}

/** 模板注册表 */
export class PromptTemplateRegistry {
  private templates: Map<string, PromptTemplate> = new Map();

  register(template: PromptTemplate): void {
    this.templates.set(template.id, template);
  }

  get(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  getAll(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  /** 构建完整 prompt（展开变量，合并段落） */
  build(
    templateId: string, 
    variables: TemplateVariables,
    customSections?: Record<string, string>  // 用户自定义覆盖
  ): string {
    const template = this.get(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);

    return template.sections
      .map(section => {
        const content = customSections?.[section.id] ?? section.content;
        return expandTemplate(content, variables);
      })
      .join("\n\n");
  }
}
```

### 8.2 Host 应用注册模板

```typescript
// lib/prompt-templates.ts
import { PromptTemplateRegistry, type PromptTemplate } from "@nocoo/next-ai";

// 定义应用专属模板
const dailyAnalysisTemplate: PromptTemplate = {
  id: "daily-analysis",
  name: "每日分析",
  description: "分析用户一天的屏幕使用数据",
  variables: [
    { key: "date", label: "日期", example: "2026-04-06", required: true },
    { key: "totalDuration", label: "总时长（分钟）", example: "342" },
    { key: "topApps", label: "Top 应用", example: "VS Code, Chrome, Slack" },
    { key: "timeline", label: "时间线", example: "[09:00] VS Code (30min)..." },
  ],
  sections: [
    {
      id: "role",
      label: "角色设定",
      content: "你是一个专业的生产力分析师，擅长分析用户的屏幕使用数据并给出改进建议。",
      editable: true,
    },
    {
      id: "data",
      label: "数据注入",
      content: `## 用户数据
- 日期：{{date}}
- 总活跃时长：{{totalDuration}} 分钟
- Top 应用：{{topApps}}
- 时间线：
{{timeline}}`,
      editable: false,  // 数据段不允许编辑
    },
    {
      id: "task",
      label: "任务要求",
      content: `## 分析任务
1. 评估用户的专注度（0-100分）
2. 列出 3 个做得好的地方
3. 列出 3 个可改进的地方
4. 按时间段总结用户的活动`,
      editable: true,
    },
    {
      id: "format",
      label: "输出格式",
      content: `## 输出要求
请以 JSON 格式返回，结构如下：
\`\`\`json
{
  "score": 75,
  "highlights": ["...", "...", "..."],
  "improvements": ["...", "...", "..."],
  "timeSegments": [{"timeRange": "09:00-11:30", "label": "...", "description": "..."}],
  "summary": "..."
}
\`\`\``,
      editable: false,  // 格式段不允许编辑
    },
  ],
};

// 创建并导出注册表
export const promptRegistry = new PromptTemplateRegistry();
promptRegistry.register(dailyAnalysisTemplate);

// 可以注册更多模板
// promptRegistry.register(weeklyReportTemplate);
// promptRegistry.register(taskSummaryTemplate);
```

### 8.3 服务端使用模板

```typescript
// app/api/analyze/route.ts
import { resolveAiConfig, createAiModel } from "@nocoo/next-ai/server";
import { generateText } from "ai";
import { promptRegistry } from "@/lib/prompt-templates";

export async function POST(req: Request) {
  const { date, stats, templateId = "daily-analysis", customSections } = await req.json();
  const settings = await loadUserSettings();
  
  const config = resolveAiConfig(settings);
  const model = createAiModel(config);
  
  // 使用模板注册表构建 prompt
  const prompt = promptRegistry.build(templateId, {
    date,
    totalDuration: stats.totalDuration,
    topApps: stats.topApps.join(", "),
    timeline: stats.timeline,
  }, customSections);  // 传入用户自定义的段落覆盖
  
  const { text } = await generateText({ model, prompt });
  return Response.json({ result: text });
}
```

### 8.4 模板变量展开

```typescript
// src/core/utils.ts

/** 变量值类型（支持嵌套对象以支持 {{user.name}} 路径） */
export type TemplateVariables = Record<string, string | number | TemplateVariables>;

/** 模板变量展开 - Mustache 风格 {{variable}} 或 {{object.path}} */
export function expandTemplate(
  template: string,
  variables: TemplateVariables
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const value = key.split(".").reduce(
      (obj: TemplateVariables | string | number | undefined, k: string) => 
        typeof obj === "object" ? obj[k] : undefined,
      variables as TemplateVariables | string | number | undefined
    );
    return value !== undefined && typeof value !== "object" 
      ? String(value) 
      : `{{${key}}}`;
  });
}
```

---

## 9. 高层 AI Helpers

封装常用 AI 调用场景，简化集成方使用。

### 9.1 Helper 接口

```typescript
// src/server/helpers.ts
import "server-only";
import { generateText, streamText, type CoreMessage } from "ai";
import { createAiModel } from "./client";
import { resolveAiConfig } from "../core/config";
import type { AiSettingsInput } from "../core/types";

export interface AiHelperOptions {
  settings: AiSettingsInput;
  maxOutputTokens?: number;
  temperature?: number;
  timeout?: number;  // ms, 默认 60000
}

export interface AiCompletionResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
}

/** 简单文本生成 */
export async function aiComplete(
  prompt: string,
  options: AiHelperOptions
): Promise<AiCompletionResult> {
  const startTime = Date.now();
  const config = resolveAiConfig(options.settings);
  const model = createAiModel(config);

  const { text, usage } = await generateText({
    model,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    abortSignal: AbortSignal.timeout(options.timeout ?? 60000),
  });

  return {
    text,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    },
    durationMs: Date.now() - startTime,
  };
}

/** 多轮对话 */
export async function aiChat(
  messages: CoreMessage[],
  options: AiHelperOptions
): Promise<AiCompletionResult> {
  const startTime = Date.now();
  const config = resolveAiConfig(options.settings);
  const model = createAiModel(config);

  const { text, usage } = await generateText({
    model,
    messages,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    abortSignal: AbortSignal.timeout(options.timeout ?? 60000),
  });

  return {
    text,
    usage: {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
    },
    durationMs: Date.now() - startTime,
  };
}

/** 流式文本生成 */
export async function aiStream(
  prompt: string,
  options: AiHelperOptions
): Promise<ReadableStream<string>> {
  const config = resolveAiConfig(options.settings);
  const model = createAiModel(config);

  const { textStream } = await streamText({
    model,
    prompt,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    abortSignal: AbortSignal.timeout(options.timeout ?? 60000),
  });

  return textStream;
}

/** 带自动重试的文本生成 */
export async function aiCompleteWithRetry(
  prompt: string,
  options: AiHelperOptions & { retries?: number; retryDelay?: number }
): Promise<AiCompletionResult> {
  const { retries = 3, retryDelay = 1000, ...helperOptions } = options;
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      return await aiComplete(prompt, helperOptions);
    } catch (error) {
      lastError = error as Error;
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * (i + 1)));
      }
    }
  }

  throw lastError;
}
```

### 9.2 使用示例

```typescript
// app/api/chat/route.ts
import { aiChat, aiStream } from "@nocoo/next-ai/server";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const settings = await loadUserSettings();

  // 普通对话
  const result = await aiChat(messages, { settings });
  return Response.json(result);
}

// 流式响应
export async function GET(req: Request) {
  const settings = await loadUserSettings();
  const stream = await aiStream("写一首关于编程的诗", { settings });
  
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

---

## 10. Storage Adapter 接口

SDK 提供存储适配器接口，**消费方必须自行实现**。API Key 等敏感数据应存储在服务端。

### 10.1 Adapter 接口定义

```typescript
// src/core/types.ts（与其他类型一起定义）

/** 存储适配器接口 - 消费方必须实现 */
export interface AiStorageAdapter {
  /** 获取当前设置（读取模型，不含真实 apiKey） */
  getSettings(): Promise<AiSettingsReadonly>;
  
  /** 保存设置（部分更新，apiKey 应提交到服务端存储） */
  saveSettings(settings: Partial<AiSettingsInput>): Promise<AiSettingsReadonly>;
  
  /** 测试 AI 连接（使用草稿配置） */
  testConnection(config: AiTestConfig): Promise<AiTestResult>;
}
```

### 10.2 推荐实现：API Route Adapter

**生产环境推荐**：通过 API Route 与服务端通信，API Key 存储在服务端数据库。

```typescript
// lib/ai-adapter.ts（消费方实现）
import type { AiStorageAdapter, AiTestConfig } from "@nocoo/next-ai";

export function createApiRouteAdapter(baseUrl = "/api/settings/ai"): AiStorageAdapter {
  return {
    async getSettings() {
      const res = await fetch(baseUrl);
      if (!res.ok) throw new Error("Failed to fetch settings");
      return res.json();
    },

    async saveSettings(updates) {
      const res = await fetch(baseUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json();
    },

    async testConnection(config: AiTestConfig) {
      const res = await fetch(`${baseUrl}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      return res.json();
    },
  };
}
```

### 10.3 服务端 API Route 示例

```typescript
// app/api/settings/ai/route.ts（消费方实现）
import { db } from "@/lib/db";  // 你的数据库

export async function GET(req: Request) {
  const userId = await getUserId(req);
  const settings = await db.aiSettings.findUnique({ where: { userId } });
  
  // 返回时不包含真实 apiKey
  return Response.json({
    provider: settings?.provider ?? "",
    model: settings?.model ?? "",
    hasApiKey: !!settings?.apiKey,
    baseURL: settings?.baseURL,
    sdkType: settings?.sdkType,
  });
}

export async function PUT(req: Request) {
  const userId = await getUserId(req);
  const updates = await req.json();
  
  // API Key 存储到服务端数据库
  const settings = await db.aiSettings.upsert({
    where: { userId },
    update: updates,
    create: { userId, ...updates },
  });
  
  return Response.json({
    provider: settings.provider,
    model: settings.model,
    hasApiKey: !!settings.apiKey,
    baseURL: settings.baseURL,
    sdkType: settings.sdkType,
  });
}
```

```typescript
// app/api/settings/ai/test/route.ts
import { validateTestConfig, resolveAiConfig, createAiModel } from "@nocoo/next-ai/server";
import { generateText } from "ai";
import type { AiTestConfig } from "@nocoo/next-ai";

export async function POST(req: Request) {
  const testConfig = (await req.json()) as AiTestConfig;

  // 使用 validateTestConfig 验证（不检查 apiKey）
  const errors = validateTestConfig(testConfig);
  if (errors.length > 0) {
    return Response.json({
      success: false,
      error: errors.map(e => e.message).join("; "),
    });
  }

  // 合并存储的 apiKey（如果请求中未提供）
  const storedSettings = await loadSettingsFromDatabase();
  const mergedConfig = {
    ...testConfig,
    apiKey: testConfig.apiKey || storedSettings.apiKey,
  };

  try {
    const resolved = resolveAiConfig(mergedConfig);
    const model = createAiModel(resolved);

    const { text } = await generateText({
      model,
      prompt: "Reply with exactly: OK",
      maxOutputTokens: 10,
    });

    return Response.json({
      success: text.includes("OK"),
      response: text,
      model: resolved.model,
      provider: resolved.provider,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
```

### 10.4 开发环境示例：localStorage（⚠️ 仅限开发）

> **⚠️ 安全警告**：以下示例**仅用于本地开发和原型验证**。
> - API Key 会以明文存储在浏览器 localStorage
> - **严禁在生产环境使用**
> - 生产环境必须使用服务端存储

```typescript
// lib/dev-adapter.ts（仅开发环境）

/** ⚠️ 仅用于开发环境，API Key 明文存储在浏览器 */
export function createDevLocalStorageAdapter(): AiStorageAdapter {
  const STORAGE_KEY = "next-ai-dev-settings";
  
  if (process.env.NODE_ENV === "production") {
    throw new Error("createDevLocalStorageAdapter is not allowed in production");
  }

  return {
    async getSettings() {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return { provider: "", model: "", hasApiKey: false };
      const data = JSON.parse(stored);
      return {
        provider: data.provider || "",
        model: data.model || "",
        hasApiKey: !!data.apiKey,
        baseURL: data.baseURL,
        sdkType: data.sdkType,
      };
    },

    async saveSettings(updates) {
      const stored = localStorage.getItem(STORAGE_KEY);
      const current = stored ? JSON.parse(stored) : {};
      const merged = { ...current, ...updates };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      return {
        provider: merged.provider || "",
        model: merged.model || "",
        hasApiKey: !!merged.apiKey,
        baseURL: merged.baseURL,
        sdkType: merged.sdkType,
      };
    },

    async testConnection(config) {
      // 开发环境可以直接调用测试端点
      const res = await fetch("/api/ai/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      return res.json();
    },
  };
}
```

---

## 11. Basalt UI 组件

遵循 Basalt 设计规范，提供开箱即用的 AI 设置面板。

### 11.1 Basalt 设计规范

**色彩系统（HSL）**

| 层级 | Light Mode | Dark Mode | 用途 |
|------|------------|-----------|------|
| L0 | `220 14% 94%` | `0 0% 9%` | 页面底色 `--background` |
| L1 | `220 14% 97%` | `0 0% 10.6%` | 浮岛内容区 `--card` |
| L2 | `0 0% 100%` | `0 0% 12.2%` | 内部卡片 `--secondary` |
| L3 | `220 13% 88%` | `0 0% 18%` | 交互控件 `--input` |

**设计原则**

- 亮度递进：Light Mode `L0 < L1 < L2`，Dark Mode `L0 < L1 < L2`
- 交互控件（L3）比容器更亮，明确"可点击/可输入"
- 圆角统一 `8px`，间距以 `4px` 为基础单位

### 11.2 CSS Tokens 和工具函数

```typescript
// src/react/styles.ts

export const basaltTokens = {
  light: {
    background: "220 14% 94%",
    foreground: "0 0% 12%",
    card: "220 14% 97%",
    cardForeground: "0 0% 12%",
    secondary: "0 0% 100%",
    secondaryForeground: "0 0% 12%",
    input: "220 13% 88%",
    border: "220 13% 88%",
    primary: "220 90% 56%",
    primaryForeground: "0 0% 100%",
    destructive: "0 84% 60%",
    destructiveForeground: "0 0% 100%",
    muted: "220 14% 96%",
    mutedForeground: "0 0% 45%",
  },
  dark: {
    background: "0 0% 9%",
    foreground: "0 0% 93%",
    card: "0 0% 10.6%",
    cardForeground: "0 0% 93%",
    secondary: "0 0% 12.2%",
    secondaryForeground: "0 0% 93%",
    input: "0 0% 18%",
    border: "0 0% 16%",
    primary: "220 90% 56%",
    primaryForeground: "0 0% 100%",
    destructive: "0 62% 50%",
    destructiveForeground: "0 0% 100%",
    muted: "0 0% 15%",
    mutedForeground: "0 0% 64%",
  },
} as const;

/** camelCase → kebab-case 转换 */
function kebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
}

/** 生成 CSS 变量字符串 */
export function generateCssVariables(mode: "light" | "dark"): string {
  const tokens = basaltTokens[mode];
  return Object.entries(tokens)
    .map(([key, value]) => `--${kebabCase(key)}: ${value};`)
    .join("\n");
}

/** 类名合并工具（替代 clsx/tailwind-merge） */
export function cn(...inputs: (string | undefined | null | false)[]): string {
  return inputs.filter(Boolean).join(" ");
}
```

### 11.3 组件设计

#### AiSettingsPanel

完整的 AI 设置面板，包含所有配置项。

```typescript
// src/react/components/AiSettingsPanel.tsx
"use client";

export interface AiSettingsPanelProps {
  /** 自定义类名 */
  className?: string;
  /** 保存成功回调 */
  onSaveSuccess?: () => void;
  /** 测试成功回调 */
  onTestSuccess?: (result: AiTestResult) => void;
  /** 测试失败回调 */
  onTestError?: (error: string) => void;
  /** 隐藏测试按钮 */
  hideTestButton?: boolean;
}

/**
 * 布局结构：
 * ┌─────────────────────────────────────────┐
 * │ AI Settings                    [Card L1] │
 * ├─────────────────────────────────────────┤
 * │ Provider        [Select ▼]              │
 * │ ─────────────────────────────────────── │
 * │ Model           [Select ▼]              │
 * │                 └─ or [Custom Input]    │
 * │ ─────────────────────────────────────── │
 * │ API Key         [●●●●●●●●] [👁]         │
 * │ ─────────────────────────────────────── │
 * │ (if custom provider)                    │
 * │ Base URL        [https://...]           │
 * │ SDK Type        [Select ▼]              │
 * │ ─────────────────────────────────────── │
 * │ [Test Connection]        [Save Settings]│
 * │ ─────────────────────────────────────── │
 * │ (Test Result Badge - success/error)     │
 * └─────────────────────────────────────────┘
 */
export function AiSettingsPanel(props: AiSettingsPanelProps) {
  // 实现...
}
```

#### ProviderSelect

Provider 选择器，支持内置和自定义 Provider。

```typescript
// src/react/components/ProviderSelect.tsx
"use client";

export interface ProviderSelectProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 下拉选项：
 * - Anthropic
 * - MiniMax
 * - GLM (Zhipu)
 * - AIHubMix
 * - ────────────
 * - Custom
 */
export function ProviderSelect(props: ProviderSelectProps) {
  const registry = useProviderRegistry();
  // 使用 registry.getAll() 渲染选项
}
```

#### ModelSelect

模型选择器，根据选中的 Provider 显示可用模型，支持自定义输入。

```typescript
// src/react/components/ModelSelect.tsx
"use client";

export interface ModelSelectProps {
  provider: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 行为：
 * 1. 根据 provider 显示预设模型列表
 * 2. 列表末尾有 "Custom model..." 选项
 * 3. 选择 Custom 后切换为文本输入框
 */
export function ModelSelect(props: ModelSelectProps) {
  const [isCustom, setIsCustom] = useState(false);
  // 实现...
}
```

#### ApiKeyInput

API Key 输入框，支持显示/隐藏切换，已保存状态提示。

```typescript
// src/react/components/ApiKeyInput.tsx
"use client";

export interface ApiKeyInputProps {
  value: string;
  onChange: (value: string) => void;
  hasStoredKey?: boolean;  // 服务端已有 key
  disabled?: boolean;
  className?: string;
}

/**
 * 状态：
 * 1. 未设置：显示空输入框
 * 2. 已设置（hasStoredKey=true）：显示 "●●●●●●●●" 占位
 * 3. 输入中：显示实际输入（可切换显示/隐藏）
 * 
 * 交互：
 * - 右侧眼睛图标切换显示/隐藏
 * - 已设置时，点击输入框清空占位开始输入
 */
export function ApiKeyInput(props: ApiKeyInputProps) {
  const [visible, setVisible] = useState(false);
  // 实现...
}
```

#### PromptTemplateSelector

模板选择器（可选组件），用于多模板场景。

```typescript
// src/react/components/PromptTemplateSelector.tsx
"use client";

export interface PromptTemplateSelectorProps {
  registry: PromptTemplateRegistry;
  value: string;
  onChange: (templateId: string) => void;
  /** 是否显示模板详情 */
  showDetails?: boolean;
  className?: string;
}

/**
 * 布局：
 * ┌─────────────────────────────────────────┐
 * │ Select template: [每日分析 ▼]           │
 * ├─────────────────────────────────────────┤
 * │ (if showDetails)                        │
 * │ 描述：分析用户一天的屏幕使用数据         │
 * │ 变量：date, totalDuration, topApps...   │
 * └─────────────────────────────────────────┘
 */
export function PromptTemplateSelector(props: PromptTemplateSelectorProps) {
  // 实现...
}
```

### 11.4 样式实现

组件使用 Tailwind CSS + CSS 变量，确保与 Basalt 主题兼容。

```tsx
// 示例：Button 样式
<button
  className={cn(
    // Base styles
    "inline-flex items-center justify-center rounded-lg px-4 py-2",
    "text-sm font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    // Basalt L3 交互控件
    "bg-[hsl(var(--input))] text-[hsl(var(--foreground))]",
    "hover:bg-[hsl(var(--input)/0.8)]",
    // Disabled
    "disabled:pointer-events-none disabled:opacity-50",
    className
  )}
>
  {children}
</button>

// 示例：Input 样式
<input
  className={cn(
    "flex h-10 w-full rounded-lg px-3 py-2",
    "text-sm",
    // Basalt L3 交互控件背景
    "bg-[hsl(var(--input))] text-[hsl(var(--foreground))]",
    "border border-[hsl(var(--border))]",
    "placeholder:text-[hsl(var(--muted-foreground))]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]",
    "disabled:cursor-not-allowed disabled:opacity-50",
    className
  )}
/>

// 示例：Card 样式
<div
  className={cn(
    "rounded-xl p-6",
    // Basalt L1 浮岛
    "bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]",
    "border border-[hsl(var(--border))]",
    className
  )}
>
  {children}
</div>
```

### 11.5 主题集成

集成方需要在根布局中引入 Basalt CSS 变量：

```tsx
// app/layout.tsx
import { basaltTokens, generateCssVariables } from "@nocoo/next-ai/react";

export default function RootLayout({ children }) {
  return (
    <html>
      <head>
        <style>{`
          :root { ${generateCssVariables("light")} }
          .dark { ${generateCssVariables("dark")} }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
```

或者使用 Tailwind CSS 配置：

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        // ... 其他 Basalt tokens
      },
    },
  },
};
```

---

## 12. 工具函数

```typescript
// src/core/utils.ts

/** 变量值类型（支持嵌套对象以支持 {{user.name}} 路径） */
export type TemplateVariables = Record<string, string | number | TemplateVariables>;

/** 模板变量展开 - Mustache 风格 {{variable}} 或 {{object.path}} */
export function expandTemplate(
  template: string,
  variables: TemplateVariables
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_, key) => {
    const value = key.split(".").reduce(
      (obj: TemplateVariables | string | number | undefined, k: string) => 
        typeof obj === "object" ? obj[k] : undefined,
      variables as TemplateVariables | string | number | undefined
    );
    return value !== undefined && typeof value !== "object" 
      ? String(value) 
      : `{{${key}}}`;
  });
}

/** 格式化秒数为可读时长 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hrs}h ${remainMins}min` : `${hrs}h`;
}

/** 解析 AI 响应 JSON（处理 markdown 代码块） */
export function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) cleaned = fenceMatch[1];
  return JSON.parse(cleaned) as T;
}
```

---

## 13. 导出结构

### 13.1 主入口 `@nocoo/next-ai`

```typescript
// src/index.ts

// Core Types (from types.ts)
export type {
  SdkType, BuiltinProvider, AiProvider, AiProviderInfo,
  AiConfig, AiSettingsInput, AiSettingsReadonly,
  AiStorageAdapter, AiTestConfig, AiTestResult,
  AiConfigError,
} from "./core/types";

// Template Types (from templates.ts)
export type {
  TemplateVariable, PromptTemplate, PromptSection,
} from "./core/templates";

// Constants
export { BUILTIN_PROVIDERS, CUSTOM_PROVIDER_INFO } from "./core/providers";

// Registry
export { AiProviderRegistry, defaultRegistry } from "./core/registry";
export { PromptTemplateRegistry } from "./core/templates";

// Config
export { resolveAiConfig, validateAiConfig, isValidProvider } from "./core/config";

// Utils
export { expandTemplate, formatDuration, parseJsonResponse } from "./core/utils";
export type { TemplateVariables } from "./core/utils";
```

### 13.2 服务端入口 `@nocoo/next-ai/server`

```typescript
// src/server.ts
export { createAiClient, createAiModel } from "./server/client";
export { aiComplete, aiChat, aiStream, aiCompleteWithRetry } from "./server/helpers";
export { resolveAiConfig, validateAiConfig } from "./core/config";
export { expandTemplate } from "./core/utils";
export type { TemplateVariables } from "./core/utils";
export { PromptTemplateRegistry } from "./core/templates";

// Core Types
export type { AiConfig, AiConfigError } from "./core/types";

// Helper Types (from helpers.ts)
export type { AiHelperOptions, AiCompletionResult } from "./server/helpers";
```

### 13.3 React 入口 `@nocoo/next-ai/react`

```typescript
// src/react.ts
"use client";

// Context & Hooks
export { AiConfigProvider, useAiConfig } from "./react/context";
export { useAiSettings, useAiTest, useProviderRegistry } from "./react/hooks";

// Components
export { AiSettingsPanel } from "./react/components/AiSettingsPanel";
export { ProviderSelect } from "./react/components/ProviderSelect";
export { ModelSelect } from "./react/components/ModelSelect";
export { ApiKeyInput } from "./react/components/ApiKeyInput";
export { PromptTemplateSelector } from "./react/components/PromptTemplateSelector";

// Styles
export { basaltTokens, generateCssVariables, cn } from "./react/styles";

// Component Types
export type { AiSettingsPanelProps } from "./react/components/AiSettingsPanel";
export type { ProviderSelectProps } from "./react/components/ProviderSelect";
export type { ModelSelectProps } from "./react/components/ModelSelect";
export type { ApiKeyInputProps } from "./react/components/ApiKeyInput";
export type { PromptTemplateSelectorProps } from "./react/components/PromptTemplateSelector";
```

---

## 14. 构建配置

### 14.1 package.json

```json
{
  "name": "@nocoo/next-ai",
  "version": "0.1.0",
  "description": "Multi-provider AI integration for Next.js",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./server": {
      "types": "./dist/server.d.ts",
      "import": "./dist/server.js",
      "require": "./dist/server.cjs"
    },
    "./react": {
      "types": "./dist/react.d.ts",
      "import": "./dist/react.js",
      "require": "./dist/react.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "bun test __tests__/unit",
    "test:integration": "bun test __tests__/integration",
    "test:coverage": "bun test __tests__/unit --coverage",
    "lint": "biome check .",
    "lint:fix": "biome check . --write",
    "typecheck": "tsc --noEmit",
    "gate:security": "bun run scripts/gate-security.ts",
    "prepublishOnly": "bun run build",
    "prepare": "husky"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0",
    "tailwindcss": "^3.4.0 || ^4.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true },
    "react-dom": { "optional": true },
    "tailwindcss": { "optional": true }
  },
  "dependencies": {
    "@ai-sdk/anthropic": "^3.0.49",
    "@ai-sdk/openai": "^3.0.36",
    "server-only": "^0.0.1"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.0",
    "@types/bun": "^1.2.5",
    "@types/react": "^19.0.0",
    "husky": "^9.0.0",
    "react": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  },
  "keywords": ["ai", "llm", "anthropic", "openai", "next.js", "react"]
}
```

> **依赖说明**：
> - `tailwindcss` 作为 optional peer dependency，React 组件依赖 Tailwind CSS 类名
> - 不使用 React 组件的消费者可以仅使用 `@nocoo/next-ai` 和 `@nocoo/next-ai/server`
> - 组件内部使用 `cn()` 工具函数拼接类名，不依赖 `clsx` 或 `tailwind-merge`

### 14.2 tsup.config.ts

```typescript
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server.ts",
    react: "src/react.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ["react", "react-dom"],
  banner: {
    js: (ctx) => ctx.format === "esm" && ctx.entryPoint.includes("react") 
      ? '"use client";' 
      : "",
  },
});
```

---

## 15. 使用示例

### 15.1 Next.js App Router 集成

#### 实现 Storage Adapter

```typescript
// lib/ai-adapter.ts
import type { AiStorageAdapter, AiTestConfig } from "@nocoo/next-ai";

export const aiAdapter: AiStorageAdapter = {
  async getSettings() {
    const res = await fetch("/api/settings/ai");
    return res.json();
  },
  async saveSettings(updates) {
    const res = await fetch("/api/settings/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return res.json();
  },
  async testConnection(config: AiTestConfig) {
    // 使用草稿配置测试，无需先保存
    const res = await fetch("/api/settings/ai/test", { 
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return res.json();
  },
};
```

#### 设置页面

```tsx
// app/settings/ai/page.tsx
"use client";

import { AiConfigProvider, AiSettingsPanel } from "@nocoo/next-ai/react";
import { aiAdapter } from "@/lib/ai-adapter";

export default function AiSettingsPage() {
  return (
    <AiConfigProvider adapter={aiAdapter}>
      <AiSettingsPanel onSaveSuccess={() => console.log("Saved!")} />
    </AiConfigProvider>
  );
}
```

#### 服务端调用

```typescript
// app/api/analyze/route.ts
import { resolveAiConfig, createAiModel } from "@nocoo/next-ai/server";
import { generateText } from "ai";

export async function POST(req: Request) {
  const settings = await loadUserSettings(); // 你的存储逻辑
  
  const config = resolveAiConfig(settings);
  const model = createAiModel(config);
  
  const { text } = await generateText({
    model,
    prompt: "Your prompt here",
  });
  
  return Response.json({ result: text });
}
```

### 15.2 自定义 Provider 注册

```typescript
import { AiProviderRegistry } from "@nocoo/next-ai";
import { AiConfigProvider } from "@nocoo/next-ai/react";

const customRegistry = new AiProviderRegistry({
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    sdkType: "openai",
    models: ["deepseek-chat", "deepseek-coder"],
    defaultModel: "deepseek-chat",
  },
});

<AiConfigProvider adapter={adapter} registry={customRegistry}>
  ...
</AiConfigProvider>
```

---

## 16. 6DQ 测试体系

采用六维质量体系（6DQ），目标 Tier S。

### 16.1 测试维度总览

| 维度 | 内容 | 要求 | 触发时机 |
|------|------|------|----------|
| **L1** | 单元测试 | ≥90% 覆盖率 | pre-commit |
| **G1** | 静态分析 | 0 error + 0 warning | pre-commit |
| **L2** | 集成测试 | Helpers 真 HTTP 测试 | pre-push |
| **G2** | 安全扫描 | osv-scanner + gitleaks | pre-push |
| **L3** | E2E 测试 | N/A（纯 SDK，无独立 UI） | - |
| **D1** | 测试隔离 | N/A（无数据库/远程存储） | - |

### 16.2 L1 单元测试

**工具**：`bun test`
**覆盖率要求**：≥90%（line + function）

| 测试文件 | 覆盖内容 |
|----------|----------|
| `__tests__/unit/providers.test.ts` | 内置 Provider 定义、常量、类型守卫 |
| `__tests__/unit/registry.test.ts` | 注册器增删查、自定义 Provider、默认实例 |
| `__tests__/unit/config.test.ts` | 校验函数、配置解析、错误处理、边界情况 |
| `__tests__/unit/templates.test.ts` | 模板注册、变量展开、多段式构建 |
| `__tests__/unit/utils.test.ts` | expandTemplate、formatDuration、parseJsonResponse |
| `__tests__/unit/styles.test.ts` | cn()、kebabCase()、generateCssVariables() |

**配置**：

```typescript
// bunfig.toml
[test]
coverage = true
coverageThreshold = { line = 90, function = 90 }
```

### 16.3 G1 静态分析

**工具**：Biome（recommended strict）+ TypeScript strict mode

**biome.json**：

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.0/schema.json",
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "style": {
        "useConst": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  }
}
```

**tsconfig.json**：

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### 16.4 L2 集成测试

**工具**：`bun test`（integration 目录）
**内容**：测试 AI Helpers 的真实 HTTP 调用

```typescript
// __tests__/integration/helpers.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { aiComplete, aiChat } from "../../src/server/helpers";

// 使用环境变量配置测试 API Key
const TEST_SETTINGS = {
  provider: "anthropic",
  apiKey: process.env.TEST_ANTHROPIC_API_KEY || "",
  model: "claude-3-5-haiku-20241022",  // 使用便宜的模型
};

describe("AI Helpers Integration", () => {
  test.skipIf(!TEST_SETTINGS.apiKey)("aiComplete returns valid response", async () => {
    const result = await aiComplete("Reply with: OK", { 
      settings: TEST_SETTINGS,
      maxOutputTokens: 10,
    });
    expect(result.text).toContain("OK");
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test.skipIf(!TEST_SETTINGS.apiKey)("aiChat handles multi-turn", async () => {
    const result = await aiChat([
      { role: "user", content: "Say hello" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "Say goodbye" },
    ], { settings: TEST_SETTINGS, maxOutputTokens: 20 });
    expect(result.text.toLowerCase()).toContain("bye");
  });
});
```

**注意**：L2 测试需要真实 API Key，CI 中通过 secrets 注入。本地开发时可 skip。

### 16.5 G2 安全扫描

**工具**：osv-scanner + gitleaks

**脚本 `scripts/gate-security.ts`**：

```typescript
#!/usr/bin/env bun
import { $ } from "bun";

async function main() {
  console.log("🔒 Running security gate...\n");

  // osv-scanner: 依赖漏洞扫描
  console.log("📦 Checking dependencies with osv-scanner...");
  const osv = await $`osv-scanner --lockfile=bun.lockb`.quiet().nothrow();
  if (osv.exitCode !== 0) {
    console.error("❌ osv-scanner found vulnerabilities:");
    console.error(osv.stderr.toString());
    process.exit(1);
  }
  console.log("✅ No known vulnerabilities\n");

  // gitleaks: secrets 泄露检测
  console.log("🔑 Checking for secrets with gitleaks...");
  const gitleaks = await $`gitleaks detect --no-banner`.quiet().nothrow();
  if (gitleaks.exitCode !== 0) {
    console.error("❌ gitleaks found secrets:");
    console.error(gitleaks.stdout.toString());
    process.exit(1);
  }
  console.log("✅ No secrets detected\n");

  console.log("🎉 Security gate passed!");
}

main();
```

### 16.6 Husky Hooks 配置

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# G1: 静态分析
echo "🔍 Running static analysis..."
bun run lint || exit 1
bun run typecheck || exit 1

# L1: 单元测试 + 覆盖率
echo "🧪 Running unit tests..."
bun test __tests__/unit --coverage || exit 1
```

```bash
# .husky/pre-push
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# L2: 集成测试（如有 API Key）
echo "🔗 Running integration tests..."
bun test __tests__/integration || true  # 允许 skip

# G2: 安全扫描
echo "🔒 Running security gate..."
bun run scripts/gate-security.ts || exit 1
```

### 16.7 Scripts 说明

完整 scripts 定义见 §14.1 package.json。关键脚本用途：

| 脚本 | 用途 | 触发时机 |
|------|------|----------|
| `test` | L1 单元测试 | 开发时、pre-commit |
| `test:integration` | L2 集成测试 | pre-push |
| `test:coverage` | 单元测试 + 覆盖率 | pre-commit |
| `lint` | Biome 静态分析 | pre-commit |
| `typecheck` | TypeScript 类型检查 | pre-commit |
| `gate:security` | G2 安全扫描 | pre-push |

### 16.8 测试示例

```typescript
// __tests__/unit/config.test.ts
import { describe, test, expect } from "bun:test";
import { resolveAiConfig, validateAiConfig } from "../../src/core/config";

describe("validateAiConfig", () => {
  test("returns empty array for valid config", () => {
    const errors = validateAiConfig({
      provider: "anthropic",
      apiKey: "sk-xxx",
      model: "claude-sonnet-4-20250514",
    });
    expect(errors).toEqual([]);
  });

  test("returns error for missing provider", () => {
    const errors = validateAiConfig({
      provider: "",
      apiKey: "sk-xxx",
      model: "",
    });
    expect(errors).toContainEqual({ field: "provider", message: "Provider is required" });
  });

  test("returns error for missing apiKey", () => {
    const errors = validateAiConfig({
      provider: "anthropic",
      apiKey: "",
      model: "",
    });
    expect(errors).toContainEqual({ field: "apiKey", message: "API key is required" });
  });

  test("returns error for unknown provider", () => {
    const errors = validateAiConfig({
      provider: "unknown",
      apiKey: "sk-xxx",
      model: "",
    });
    expect(errors).toContainEqual({ field: "provider", message: "Unknown provider: unknown" });
  });

  test("returns errors for custom provider missing fields", () => {
    const errors = validateAiConfig({
      provider: "custom",
      apiKey: "sk-xxx",
      model: "my-model",
    });
    expect(errors).toContainEqual({ field: "baseURL", message: "Base URL is required for custom provider" });
    expect(errors).toContainEqual({ field: "sdkType", message: "SDK type is required for custom provider" });
  });
});

describe("resolveAiConfig", () => {
  test("uses provider default model when model is empty", () => {
    const config = resolveAiConfig({
      provider: "anthropic",
      apiKey: "sk-xxx",
      model: "",
    });
    expect(config.model).toBe("claude-sonnet-4-20250514");
  });

  test("throws combined error message for invalid config", () => {
    expect(() => resolveAiConfig({
      provider: "",
      apiKey: "",
      model: "",
    })).toThrow("provider: Provider is required; apiKey: API key is required");
  });
});
```

---

## 17. 实施计划

### Phase 1: 核心模块（1-2h）

- [x] 创建包目录结构
- [x] 实现 `core/types.ts`
- [x] 实现 `core/providers.ts`
- [x] 实现 `core/registry.ts`
- [x] 实现 `core/config.ts`
- [x] 实现 `core/templates.ts`
- [x] 实现 `core/utils.ts`
- [x] 编写 L1 单元测试

### Phase 2: 服务端模块（1h）

- [x] 实现 `server/client.ts`
- [x] 实现 `server/helpers.ts`（aiComplete, aiChat, aiStream）
- [x] 配置 `server-only` 保护
- [x] 编写 L2 集成测试

### Phase 3: React 模块（2-3h）

- [x] 实现 `react/styles.ts`（Basalt tokens）
- [x] 实现 Context Provider
- [x] 实现 Hooks
- [x] 实现 `AiSettingsPanel` 组件
- [x] 实现子组件（ProviderSelect, ModelSelect, ApiKeyInput, PromptTemplateSelector）

### Phase 4: 质量门控（0.5h）

- [x] 配置 Biome（G1）
- [x] 配置 Husky hooks
- [x] 编写 gate-security.ts（G2）
- [x] 验证覆盖率 ≥90%

### Phase 5: 构建与发布（0.5h）

- [x] 配置 tsup 构建
- [x] 配置 package.json exports
- [x] 编写 README
- [ ] 发布到 npm

### Phase 6: Gecko 迁移（1h）

- [ ] 在 Gecko 中安装 `@nocoo/next-ai`
- [ ] 替换现有 `services/ai.ts`
- [ ] 迁移 UI 组件使用新包
- [ ] 验证功能正常

---

## 18. 验证清单

**功能验证**
- [x] Next.js 项目可正常 import 三个入口
- [x] 服务端入口在客户端 import 时报错（server-only 生效）
- [x] 自定义 Provider 注册可用
- [x] Storage Adapter 接口可实现
- [x] 多模板 Prompt 系统正常工作
- [x] AI Helpers（chat/completion/stream）正常工作

**质量验证**
- [x] `bun test` 全部通过
- [x] `bun run lint` 0 error + 0 warning
- [x] `bun run typecheck` 无错误
- [x] 覆盖率 ≥90%（线覆盖率 100%）
- [x] `bun run build` 无错误
- [ ] G2 安全扫描通过（需安装 osv-scanner 和 gitleaks）

---

## 19. 需要修改的文件

### 19.1 新建文件（next-ai/）

| 文件路径 | 说明 |
|----------|------|
| `package.json` | 包配置 |
| `tsconfig.json` | TypeScript 配置（strict） |
| `tsup.config.ts` | 构建配置 |
| `biome.json` | G1 静态分析配置 |
| `src/index.ts` | 主入口 |
| `src/server.ts` | 服务端入口 |
| `src/react.ts` | React 入口 |
| `src/core/types.ts` | 类型定义 |
| `src/core/providers.ts` | 内置 Provider |
| `src/core/registry.ts` | Provider 注册器 |
| `src/core/templates.ts` | Prompt 模板系统 |
| `src/core/config.ts` | 配置解析 |
| `src/core/utils.ts` | 工具函数 |
| `src/server/client.ts` | AI 客户端 |
| `src/server/helpers.ts` | 高层 AI Helpers |
| `src/react/styles.ts` | Basalt CSS tokens + cn utility |
| `src/react/context.tsx` | Context Provider |
| `src/react/hooks.ts` | Hooks |
| `src/react/components/*.tsx` | UI 组件 |
| `scripts/gate-security.ts` | G2 安全扫描脚本 |
| `__tests__/unit/*.test.ts` | L1 单元测试 |
| `__tests__/integration/*.test.ts` | L2 集成测试 |

### 19.2 Gecko 迁移修改

| 文件路径 | 改动 |
|----------|------|
| `apps/web-dashboard/package.json` | 添加 `@nocoo/next-ai` 依赖 |
| `apps/web-dashboard/src/services/ai.ts` | 改为从包 re-export |
| `apps/web-dashboard/src/components/ai-settings.tsx` | 使用包组件或保留自定义 |
