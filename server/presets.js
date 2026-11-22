/**
 * Official provider presets and upstream URL normalization helpers for 001Router.
 * Supports official API keys, free-tier developer APIs, documented OAuth/Device flows,
 * and local self-hosted LLMs only. Zero client spoofing, zero web cookies, zero MITM.
 */

import { enrichPresetWithCatalog, onCatalogReload } from "./catalog/index.js";

const RAW_PRESETS = [
  // --- Free-tier developer APIs ---
  {
    preset: "gemini",
    name: "Google Gemini",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    color: "#4285F4",
    monogram: "GM",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    formatType: "gemini-openai",
    authStyle: "bearer",
    authModes: ["apikey", "oauth_pkce", "json"],
    oauthType: "google",
    docsUrl: "https://aistudio.google.com/apikey",
    keyOptional: false,
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]
  },
  {
    preset: "groq",
    name: "Groq",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    color: "#F55036",
    monogram: "GQ",
    baseUrl: "https://api.groq.com/openai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://console.groq.com/keys",
    keyOptional: false,
    models: [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768"
    ]
  },
  {
    preset: "cerebras",
    name: "Cerebras",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    color: "#FF6B00",
    monogram: "CB",
    baseUrl: "https://api.cerebras.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://cloud.cerebras.ai/",
    keyOptional: false,
    models: ["llama-3.3-70b", "llama3.1-8b", "qwen-3-32b"]
  },
  {
    preset: "openrouter",
    name: "OpenRouter",
    category: "free-tier",
    tier: "free",
    badge: "Free Models",
    color: "#6366F1",
    monogram: "OR",
    baseUrl: "https://openrouter.ai/api/v1",
    formatType: "openai",
    authStyle: "bearer",
    authModes: ["apikey", "oauth_pkce", "json"],
    oauthType: "openrouter",
    docsUrl: "https://openrouter.ai/keys",
    keyOptional: false,
    models: [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o",
      "google/gemini-2.5-flash",
      "deepseek/deepseek-r1:free"
    ]
  },
  {
    preset: "nvidia",
    name: "NVIDIA NIM",
    category: "free-tier",
    tier: "free",
    badge: "Free Credits",
    color: "#76B900",
    monogram: "NV",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://build.nvidia.com/",
    keyOptional: false,
    models: [
      "meta/llama-3.3-70b-instruct",
      "deepseek-ai/deepseek-r1",
      "qwen/qwen2.5-coder-32b-instruct"
    ]
  },
  {
    preset: "sambanova",
    name: "SambaNova",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    color: "#F97316",
    monogram: "SN",
    baseUrl: "https://api.sambanova.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://cloud.sambanova.ai/apis",
    keyOptional: false,
    models: [
      "Meta-Llama-3.3-70B-Instruct",
      "DeepSeek-R1-Distill-Llama-70B",
      "Qwen2.5-Coder-32B-Instruct"
    ]
  },
  {
    preset: "huggingface",
    name: "Hugging Face",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    color: "#FFD21E",
    monogram: "HF",
    baseUrl: "https://router.huggingface.co/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://huggingface.co/settings/tokens",
    keyOptional: false,
    models: [
      "meta-llama/Llama-3.3-70B-Instruct",
      "Qwen/Qwen2.5-Coder-32B-Instruct",
      "deepseek-ai/DeepSeek-R1"
    ]
  },
  {
    preset: "mistral",
    name: "Mistral",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    color: "#FF7000",
    monogram: "MS",
    baseUrl: "https://api.mistral.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://console.mistral.ai/api-keys",
    keyOptional: false,
    models: [
      "mistral-large-latest",
      "mistral-small-latest",
      "codestral-latest"
    ]
  },
  {
    preset: "cloudflare",
    name: "Cloudflare Workers AI",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    color: "#F38020",
    monogram: "CF",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/ACCOUNT_ID/ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/",
    keyOptional: false,
    models: [
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      "@cf/qwen/qwen2.5-coder-32b-instruct",
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b"
    ]
  },
  {
    preset: "byteplus",
    name: "BytePlus ModelArk",
    category: "free-tier",
    tier: "free",
    badge: "Free Credits",
    logo: "byteplus",
    color: "#2563EB",
    monogram: "BP",
    baseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v3",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://console.byteplus.com/ark",
    keyOptional: false,
    models: [
      "seed-2-0-pro-260328",
      "seed-2-0-code-preview-260328",
      "seed-2-0-mini-260215",
      "seed-2-0-lite-260228"
    ]
  },
  {
    preset: "kilocode",
    name: "Kilo Code",
    category: "free-tier",
    tier: "free",
    badge: "Device Auth",
    logo: "kilocode",
    color: "#FF6B35",
    monogram: "KC",
    baseUrl: "https://api.kilo.ai/api/openrouter",
    formatType: "openai",
    authStyle: "bearer",
    authModes: ["device_code", "apikey"],
    oauthType: "kilocode",
    docsUrl: "https://kilo.ai/dashboard?tab=apiKeys",
    keyOptional: false,
    models: [
      "anthropic/claude-sonnet-4-20250514",
      "google/gemini-2.5-pro",
      "google/gemini-2.5-flash",
      "openai/gpt-4.1",
      "deepseek/deepseek-chat"
    ]
  },
  {
    preset: "kilo-gateway",
    name: "Kilo Gateway",
    category: "free-tier",
    tier: "free",
    badge: "Free Models",
    logo: "kilo-gateway",
    color: "#8B5CF6",
    monogram: "KG",
    baseUrl: "https://api.kilo.ai/api/gateway",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://kilo.ai/dashboard?tab=apiKeys",
    keyOptional: false,
    models: [
      "kilo-auto/free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "kwaipilot/kat-coder-pro-v2.5:free",
      "kilo-auto/frontier",
      "kilo-auto/balanced"
    ]
  },
  {
    preset: "api-airforce",
    name: "API.airforce",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    logo: "api-airforce",
    color: "#0EA5E9",
    monogram: "AF",
    baseUrl: "https://api.airforce/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://api.airforce",
    keyOptional: false,
    models: ["gpt-oss-120b", "gpt-oss-20b", "kimi-k2.7-code"]
  },
  {
    preset: "bazaarlink",
    name: "Bazaarlink",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    logo: "bazaarlink",
    color: "#0F766E",
    monogram: "BZ",
    baseUrl: "https://bazaarlink.ai/api/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://bazaarlink.ai",
    keyOptional: false,
    models: ["auto:free", "claude-sonnet-4.6", "gpt-5.4", "gemini-2.5-flash"]
  },
  {
    preset: "poolside",
    name: "Poolside",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    logo: "poolside",
    color: "#2563EB",
    monogram: "PS",
    baseUrl: "https://inference.poolside.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.poolside.ai/api-keys",
    keyOptional: false,
    models: ["poolside/laguna-s-2.1", "poolside/laguna-xs-2.1"]
  },
  {
    preset: "agnes",
    name: "Agnes AI",
    category: "free-tier",
    tier: "free",
    badge: "Free Tier",
    logo: "agnes",
    color: "#7C3AED",
    monogram: "AG",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.agnes-ai.com",
    keyOptional: false,
    models: ["agnes-3.0-flash", "agnes-2.5-pro", "agnes-2.5-flash"]
  },
  {
    preset: "runcrate",
    name: "Runcrate",
    category: "free-tier",
    tier: "free",
    badge: "Free Credits",
    logo: "runcrate",
    color: "#16A34A",
    monogram: "RC",
    baseUrl: "https://api.runcrate.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.runcrate.ai/dashboard/api-keys",
    keyOptional: false,
    models: [
      "deepseek-ai/DeepSeek-V4.1-Flash",
      "zai-org/GLM-5.3-Flash",
      "Qwen/Qwen3.8-Flash",
      "openai/gpt-oss-120b"
    ]
  },

  // --- Official API Key Providers ---
  {
    preset: "muse",
    name: "Muse (Meta Model API)",
    category: "apikey",
    tier: "premium",
    logo: "muse",
    color: "#0866FF",
    monogram: "MU",
    baseUrl: "https://api.meta.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://dev.meta.ai",
    keyOptional: false,
    models: [
      "muse-ember",
      "muse-spark-open",
      "muse-wonder",
      "muse-spark-1.3",
      "muse-spark-1.3-contributor",
      "muse-spark-1.2",
      "muse-spark-1.1"
    ]
  },
  {
    preset: "openai",
    name: "OpenAI",
    category: "apikey",
    tier: "premium",
    color: "#10A37F",
    monogram: "OA",
    baseUrl: "https://api.openai.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.openai.com/api-keys",
    keyOptional: false,
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4.1"]
  },
  {
    preset: "anthropic",
    name: "Anthropic",
    category: "apikey",
    tier: "premium",
    color: "#D97757",
    monogram: "AN",
    baseUrl: "https://api.anthropic.com",
    formatType: "anthropic",
    authStyle: "x-api-key",
    docsUrl: "https://console.anthropic.com/settings/keys",
    keyOptional: false,
    models: [
      "claude-sonnet-4-20250514",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022"
    ]
  },
  {
    preset: "deepseek",
    name: "DeepSeek",
    category: "apikey",
    tier: "cheap",
    color: "#4D6BFE",
    monogram: "DS",
    baseUrl: "https://api.deepseek.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.deepseek.com/api_keys",
    keyOptional: false,
    models: ["deepseek-chat", "deepseek-reasoner"]
  },
  {
    preset: "xai",
    name: "xAI",
    category: "apikey",
    tier: "premium",
    color: "#18181B",
    monogram: "XA",
    baseUrl: "https://api.x.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://console.x.ai/",
    keyOptional: false,
    models: ["grok-3", "grok-3-mini", "grok-2-1212"]
  },
  {
    preset: "together",
    name: "Together AI",
    category: "apikey",
    tier: "cheap",
    color: "#0F6FFF",
    monogram: "TG",
    baseUrl: "https://api.together.xyz/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://api.together.xyz/settings/api-keys",
    keyOptional: false,
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "deepseek-ai/DeepSeek-R1"
    ]
  },
  {
    preset: "fireworks",
    name: "Fireworks AI",
    category: "apikey",
    tier: "cheap",
    color: "#8B5CF6",
    monogram: "FW",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://fireworks.ai/account/api-keys",
    keyOptional: false,
    models: [
      "accounts/fireworks/models/llama-v3p3-70b-instruct",
      "accounts/fireworks/models/deepseek-r1",
      "accounts/fireworks/models/qwen2p5-coder-32b-instruct"
    ]
  },
  {
    preset: "perplexity",
    name: "Perplexity",
    category: "apikey",
    tier: "premium",
    color: "#20808D",
    monogram: "PX",
    baseUrl: "https://api.perplexity.ai",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.perplexity.ai/settings/api",
    keyOptional: false,
    models: ["sonar", "sonar-pro", "sonar-reasoning-pro"]
  },
  {
    preset: "cohere",
    name: "Cohere",
    category: "apikey",
    tier: "premium",
    color: "#39594D",
    monogram: "CO",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://dashboard.cohere.com/api-keys",
    keyOptional: false,
    models: ["command-a-03-2025", "command-r-plus-08-2024", "command-r-08-2024"]
  },
  {
    preset: "glm",
    name: "Zhipu GLM / Z.ai",
    category: "apikey",
    tier: "cheap",
    color: "#3B82F6",
    monogram: "GL",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    keyOptional: false,
    models: ["glm-4-plus", "glm-4-air", "glm-4-flash"]
  },
  {
    preset: "kimi",
    name: "Moonshot Kimi",
    category: "apikey",
    tier: "cheap",
    color: "#1E293B",
    monogram: "KM",
    baseUrl: "https://api.moonshot.cn/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.moonshot.cn/console/api-keys",
    keyOptional: false,
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]
  },
  {
    preset: "minimax",
    name: "MiniMax",
    category: "apikey",
    tier: "cheap",
    color: "#EC4899",
    monogram: "MM",
    baseUrl: "https://api.minimax.chat/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.minimaxi.com/",
    keyOptional: false,
    models: ["MiniMax-Text-01", "abab6.5s-chat"]
  },
  {
    preset: "alibaba",
    name: "Alibaba DashScope Qwen",
    category: "apikey",
    tier: "cheap",
    color: "#FF6A00",
    monogram: "QW",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://dashscope.console.aliyun.com/apiKey",
    keyOptional: false,
    models: ["qwen-max", "qwen-plus", "qwen-turbo", "qwen-coder-plus"]
  },
  {
    preset: "siliconflow",
    name: "SiliconFlow",
    category: "apikey",
    tier: "cheap",
    color: "#7C3AED",
    monogram: "SF",
    baseUrl: "https://api.siliconflow.cn/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://cloud.siliconflow.cn/account/ak",
    keyOptional: false,
    models: [
      "deepseek-ai/DeepSeek-V3",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen2.5-72B-Instruct"
    ]
  },
  {
    preset: "nebius",
    name: "Nebius AI Studio",
    category: "apikey",
    tier: "cheap",
    color: "#0EA5E9",
    monogram: "NB",
    baseUrl: "https://api.studio.nebius.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://studio.nebius.com/settings/api-keys",
    keyOptional: false,
    models: [
      "meta-llama/Llama-3.3-70B-Instruct",
      "Qwen/Qwen2.5-Coder-32B-Instruct",
      "deepseek-ai/DeepSeek-R1"
    ]
  },
  {
    preset: "hyperbolic",
    name: "Hyperbolic",
    category: "apikey",
    tier: "cheap",
    color: "#06B6D4",
    monogram: "HB",
    baseUrl: "https://api.hyperbolic.xyz/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://app.hyperbolic.xyz/settings",
    keyOptional: false,
    models: [
      "meta-llama/Llama-3.3-70B-Instruct",
      "deepseek-ai/DeepSeek-V3",
      "Qwen/Qwen2.5-Coder-32B-Instruct"
    ]
  },
  {
    preset: "chutes",
    name: "Chutes",
    category: "apikey",
    tier: "cheap",
    color: "#14B8A6",
    monogram: "CH",
    baseUrl: "https://llm.chutes.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://chutes.ai/app/api",
    keyOptional: false,
    models: [
      "deepseek-ai/DeepSeek-V3-0324",
      "deepseek-ai/DeepSeek-R1",
      "Qwen/Qwen2.5-72B-Instruct"
    ]
  },
  {
    preset: "venice",
    name: "Venice AI",
    category: "apikey",
    tier: "cheap",
    color: "#DC2626",
    monogram: "VN",
    baseUrl: "https://api.venice.ai/api/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://venice.ai/settings/api",
    keyOptional: false,
    models: ["llama-3.3-70b", "deepseek-r1-671b", "qwen-2.5-coder-32b"]
  },
  {
    preset: "vercel",
    name: "Vercel AI Gateway",
    category: "apikey",
    tier: "premium",
    color: "#000000",
    monogram: "VC",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://vercel.com/docs/ai-gateway",
    keyOptional: false,
    models: [
      "openai/gpt-4o",
      "anthropic/claude-sonnet-4",
      "google/gemini-2.5-flash"
    ]
  },
  {
    preset: "featherless",
    name: "Featherless AI",
    category: "apikey",
    tier: "cheap",
    color: "#A855F7",
    monogram: "FL",
    baseUrl: "https://api.featherless.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://featherless.ai/account/api-keys",
    keyOptional: false,
    models: [
      "meta-llama/Meta-Llama-3.1-70B-Instruct",
      "Qwen/Qwen2.5-72B-Instruct"
    ]
  },
  {
    preset: "novita",
    name: "Novita AI",
    category: "apikey",
    tier: "cheap",
    color: "#10B981",
    monogram: "NO",
    baseUrl: "https://api.novita.ai/v3/openai",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://novita.ai/settings/key-management",
    keyOptional: false,
    models: [
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-r1-0528"
    ]
  },
  {
    preset: "reka",
    name: "Reka AI",
    category: "apikey",
    tier: "premium",
    color: "#6366F1",
    monogram: "RK",
    baseUrl: "https://api.reka.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.reka.ai/",
    keyOptional: false,
    models: ["reka-flash-3", "reka-core"]
  },
  {
    preset: "xiaomi",
    name: "Xiaomi MiMo",
    category: "apikey",
    tier: "cheap",
    logo: "xiaomi-mimo",
    color: "#FF6900",
    monogram: "XM",
    baseUrl: "https://api.xiaomimimo.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.xiaomimimo.com/console/api-keys",
    keyOptional: false,
    models: ["mimo-v2.6-pro-ultraspeed", "mimo-v2.6-pro", "mimo-v2.6-flash"]
  },
  {
    preset: "baidu",
    name: "Baidu Qianfan (ERNIE)",
    category: "apikey",
    tier: "cheap",
    logo: "baidu",
    color: "#2932E1",
    monogram: "BD",
    baseUrl: "https://qianfan.baidubce.com/v2",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://console.bce.baidu.com/qianfan",
    keyOptional: false,
    models: [
      "ernie-5.5-flash-preview",
      "ernie-light-dt-1.0-intl",
      "deepseek-v4-pro",
      "deepseek-v4-flash"
    ]
  },
  {
    preset: "tencent",
    name: "Tencent Hunyuan",
    category: "apikey",
    tier: "cheap",
    logo: "tencent",
    color: "#0052D9",
    monogram: "HY",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://console.cloud.tencent.com/hunyuan/api-key",
    keyOptional: false,
    models: ["hy4-flash", "hunyuan-turbos-latest", "hunyuan-t1-latest"]
  },
  {
    preset: "nous",
    name: "Nous Research",
    category: "apikey",
    tier: "cheap",
    logo: "nous",
    color: "#6366F1",
    monogram: "NR",
    baseUrl: "https://inference-api.nousresearch.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    authModes: ["device_code", "apikey"],
    oauthType: "nous",
    docsUrl: "https://portal.nousresearch.com/api-keys",
    keyOptional: false,
    models: ["Hermes-4-405B", "Hermes-4-70B"]
  },
  {
    preset: "opencode-zen",
    name: "OpenCode Zen",
    category: "apikey",
    tier: "cheap",
    badge: "Coding Gateway",
    logo: "opencode",
    color: "#E87040",
    monogram: "OZ",
    baseUrl: "https://opencode.ai/zen/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://opencode.ai/auth",
    keyOptional: false,
    models: [
      "claude-sonnet-4-6",
      "gpt-5.4",
      "gemini-3.6-flash",
      "deepseek-v4-flash",
      "glm-5.3"
    ]
  },
  {
    preset: "opencode-go",
    name: "OpenCode Go",
    category: "apikey",
    tier: "cheap",
    badge: "Coding Plan",
    logo: "opencode-go",
    color: "#EA580C",
    monogram: "OG",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://opencode.ai/auth",
    keyOptional: false,
    models: [
      "deepseek-v4-flash",
      "glm-5.3",
      "kimi-k2.7-code",
      "minimax-m2.7",
      "qwen3.7-plus"
    ]
  },
  {
    preset: "glm-cn",
    name: "Zhipu GLM Coding (CN)",
    category: "apikey",
    tier: "cheap",
    logo: "glm-cn",
    color: "#2563EB",
    monogram: "GC",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    keyOptional: false,
    models: ["glm-5.3", "glm-5.3-flash", "glm-5.2", "glm-5"]
  },
  {
    preset: "minimax-cn",
    name: "MiniMax Coding (CN)",
    category: "apikey",
    tier: "cheap",
    logo: "minimax-cn",
    color: "#EC4899",
    monogram: "MC",
    baseUrl: "https://api.minimaxi.com/anthropic",
    formatType: "anthropic",
    authStyle: "x-api-key",
    docsUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    keyOptional: false,
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1"]
  },
  {
    preset: "alicode",
    name: "Alibaba Coding (CN)",
    category: "apikey",
    tier: "cheap",
    logo: "alicode",
    color: "#FF6A00",
    monogram: "AC",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://bailian.console.aliyun.com/?apiKey=1",
    keyOptional: false,
    models: ["qwen3.5-plus", "qwen3-coder-next", "glm-5", "kimi-k2.5"]
  },
  {
    preset: "alicode-intl",
    name: "Alibaba Coding (Intl)",
    category: "apikey",
    tier: "cheap",
    logo: "alicode-intl",
    color: "#FF6A00",
    monogram: "AI",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.alibabacloud.com/product/coding",
    keyOptional: false,
    models: ["qwen3.5-plus", "qwen3-coder-plus", "glm-5", "kimi-k2.5"]
  },
  {
    preset: "alitp-intl",
    name: "Alibaba Token Plan (Intl)",
    category: "apikey",
    tier: "cheap",
    logo: "alitp-intl",
    color: "#EA580C",
    monogram: "AT",
    baseUrl: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1",
    keyOptional: false,
    models: ["qwen3.8-max-preview", "qwen3.7-plus", "glm-5.2", "deepseek-v4-pro"]
  },
  {
    preset: "volcengine-ark",
    name: "Volcengine Ark (ByteDance)",
    category: "apikey",
    tier: "cheap",
    logo: "volcengine-ark",
    color: "#2563EB",
    monogram: "VA",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://console.volcengine.com/ark",
    keyOptional: false,
    models: ["Doubao-Seed-2.0-Code", "Doubao-Seed-2.0-pro", "DeepSeek-V4-Flash"]
  },
  {
    preset: "xiaomi-tokenplan",
    name: "Xiaomi MiMo Token Plan",
    category: "apikey",
    tier: "cheap",
    logo: "xiaomi-tokenplan",
    color: "#FF6900",
    monogram: "XT",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://mimo.xiaomi.com",
    keyOptional: false,
    models: ["mimo-v2.6-pro", "mimo-v2.6-flash"]
  },
  {
    preset: "llm7",
    name: "LLM7",
    category: "apikey",
    tier: "cheap",
    logo: "llm7",
    color: "#7C3AED",
    monogram: "L7",
    baseUrl: "https://api.llm7.io/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://llm7.io",
    keyOptional: false,
    models: ["gpt-5.5", "claude-opus-5", "deepseek-v4-flash", "kimi-k3"]
  },
  {
    preset: "synthetic",
    name: "Synthetic",
    category: "apikey",
    tier: "cheap",
    logo: "synthetic",
    color: "#0EA5E9",
    monogram: "SY",
    baseUrl: "https://api.synthetic.new/openai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://synthetic.new/user-settings/api",
    keyOptional: false,
    models: [
      "hf:zai-org/GLM-5.3",
      "hf:moonshotai/Kimi-K3",
      "hf:deepseek-ai/DeepSeek-V4.1-Flash"
    ]
  },
  {
    preset: "morph",
    name: "Morph",
    category: "apikey",
    tier: "cheap",
    logo: "morph",
    color: "#6366F1",
    monogram: "MP",
    baseUrl: "https://api.morphllm.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://morphllm.com",
    keyOptional: false,
    models: ["morph-v3-large", "morph-v3-fast", "morph-dsv4flash"]
  },
  {
    preset: "blackbox",
    name: "Blackbox AI",
    category: "apikey",
    tier: "cheap",
    logo: "blackbox",
    color: "#18181B",
    monogram: "BB",
    baseUrl: "https://api.blackbox.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.blackbox.ai/api-management",
    keyOptional: false,
    models: ["claude-sonnet-4.6", "gpt-5.4", "claude-opus-4.8"]
  },
  {
    preset: "tokenharbor",
    name: "Token Harbor",
    category: "apikey",
    tier: "cheap",
    logo: "tokenharbor",
    color: "#0284C7",
    monogram: "TH",
    baseUrl: "https://tokenharbor.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://tokenharbor.ai/dashboard",
    keyOptional: false,
    models: ["claude-sonnet-5", "gpt-6-sol", "deepseek-v4.1-flash:free"]
  },
  {
    preset: "tokenrouter",
    name: "TokenRouter",
    category: "apikey",
    tier: "cheap",
    logo: "tokenrouter",
    color: "#4F46E5",
    monogram: "TR",
    baseUrl: "https://api.tokenrouter.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.tokenrouter.com",
    keyOptional: false,
    models: ["anthropic/claude-sonnet-4.6", "openai/gpt-5.4"]
  },
  {
    preset: "bluesminds",
    name: "BluesMinds",
    category: "apikey",
    tier: "cheap",
    logo: "bluesminds",
    color: "#2563EB",
    monogram: "BM",
    baseUrl: "https://api.bluesminds.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://bluesminds.com",
    keyOptional: false,
    models: ["gpt-4.1", "claude-sonnet-4-5", "gemini-2.0-flash"]
  },
  {
    preset: "dahl",
    name: "Dahl Inference",
    category: "apikey",
    tier: "cheap",
    logo: "dahl",
    color: "#0D9488",
    monogram: "DH",
    baseUrl: "https://inference.dahl.global/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://dahl.global/dashboard",
    keyOptional: false,
    models: [
      "zai-org/GLM-5.3-Flash",
      "deepseek-ai/DeepSeek-V4-Flash-0731",
      "MiniMaxAI/MiniMax-M2.7"
    ]
  },
  {
    preset: "sensenova",
    name: "SenseNova (CN)",
    category: "apikey",
    tier: "cheap",
    logo: "sensenova",
    color: "#0284C7",
    monogram: "SN",
    baseUrl: "https://token.sensenova.cn/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://token.sensenova.cn",
    keyOptional: false,
    models: ["sensenova-6.8-flash", "deepseek-v4-flash"]
  },
  {
    preset: "sensenova-intl",
    name: "SenseNova (Intl)",
    category: "apikey",
    tier: "cheap",
    logo: "sensenova-intl",
    color: "#0369A1",
    monogram: "SI",
    baseUrl: "https://token.sensenova.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.sensenova.ai",
    keyOptional: false,
    models: ["sensenova-6.8-flash", "sensenova-6.8-flash-lite"]
  },
  {
    preset: "gitlab",
    name: "GitLab Duo",
    category: "apikey",
    tier: "premium",
    badge: "OAuth PKCE / PAT",
    logo: "gitlab",
    color: "#FC6D26",
    monogram: "GL",
    baseUrl: "https://gitlab.com/api/v4",
    formatType: "openai",
    authStyle: "bearer",
    authModes: ["oauth_pkce", "apikey"],
    oauthType: "gitlab",
    docsUrl: "https://docs.gitlab.com/ee/api/oauth2.html",
    keyOptional: false,
    models: ["duo-chat", "claude-sonnet-4-20250514"]
  },
  {
    preset: "vertex-partner",
    name: "Vertex Partner",
    category: "apikey",
    tier: "premium",
    logo: "vertex-partner",
    color: "#4285F4",
    monogram: "VP",
    baseUrl: "https://aiplatform.googleapis.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    authModes: ["apikey", "json"],
    docsUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    keyOptional: false,
    models: [
      "deepseek-ai/deepseek-v3.2-maas",
      "qwen/qwen3-next-80b-a3b-instruct-maas",
      "zai-org/glm-5-maas"
    ]
  },
  {
    preset: "bedrock-xai",
    name: "AWS Bedrock (xAI)",
    category: "apikey",
    tier: "premium",
    logo: "bedrock-xai",
    color: "#FF9900",
    monogram: "BX",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://aws.amazon.com/bedrock/",
    keyOptional: false,
    models: ["us.xai.grok-4.6", "global.xai.grok-4.6"]
  },
  {
    preset: "azure",
    name: "Azure OpenAI",
    category: "apikey",
    tier: "premium",
    color: "#0078D4",
    monogram: "AZ",
    baseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/v1",
    formatType: "openai",
    authStyle: "api-key",
    docsUrl: "https://learn.microsoft.com/en-us/azure/ai-services/openai/",
    keyOptional: false,
    models: ["gpt-4.1", "gpt-4o", "o3-mini"]
  },
  {
    preset: "bedrock",
    name: "Amazon Bedrock",
    category: "apikey",
    tier: "premium",
    color: "#FF9900",
    monogram: "BR",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://aws.amazon.com/bedrock/",
    keyOptional: false,
    models: ["amazon.nova-premier-v1", "amazon.nova-pro-v1"]
  },
  {
    preset: "vertex",
    name: "Google Vertex AI",
    category: "apikey",
    tier: "premium",
    color: "#4285F4",
    monogram: "VX",
    baseUrl: "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/PROJECT/locations/us-central1/endpoints/openapi",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://cloud.google.com/vertex-ai",
    keyOptional: false,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"]
  },

  // --- Local Self-Hosted LLMs ---
  {
    preset: "ollama",
    name: "Ollama",
    category: "local",
    tier: "local",
    badge: "Local",
    color: "#111827",
    monogram: "OL",
    baseUrl: "http://localhost:11434/v1",
    formatType: "openai",
    authStyle: "none",
    docsUrl: "https://ollama.com/library",
    keyOptional: true,
    models: ["llama3.2", "qwen2.5-coder", "deepseek-r1:8b"]
  },
  {
    preset: "lmstudio",
    name: "LM Studio",
    category: "local",
    tier: "local",
    badge: "Local",
    color: "#4F46E5",
    monogram: "LM",
    baseUrl: "http://localhost:1234/v1",
    formatType: "openai",
    authStyle: "none",
    docsUrl: "https://lmstudio.ai/docs/app/api",
    keyOptional: true,
    models: ["local-model"]
  },
  {
    preset: "vllm",
    name: "vLLM",
    category: "local",
    tier: "local",
    badge: "Local",
    color: "#2563EB",
    monogram: "VL",
    baseUrl: "http://localhost:8000/v1",
    formatType: "openai",
    authStyle: "none",
    docsUrl: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html",
    keyOptional: true,
    models: ["default"]
  },
  {
    preset: "llamacpp",
    name: "llama.cpp",
    category: "local",
    tier: "local",
    badge: "Local",
    color: "#059669",
    monogram: "LC",
    baseUrl: "http://localhost:8080/v1",
    formatType: "openai",
    authStyle: "none",
    docsUrl: "https://github.com/ggml-org/llama.cpp/tree/master/tools/server",
    keyOptional: true,
    models: ["local-gguf"]
  },
  {
    preset: "comfyui",
    name: "ComfyUI",
    category: "local",
    tier: "local",
    badge: "Local Image",
    logo: "comfyui",
    color: "#111827",
    monogram: "CF",
    baseUrl: "http://localhost:8188",
    formatType: "openai",
    authStyle: "none",
    docsUrl: "https://github.com/comfyanonymous/ComfyUI",
    keyOptional: true,
    serviceKinds: ["image"],
    models: ["flux-dev", "sdxl"]
  },
  {
    preset: "sdwebui",
    name: "SD WebUI",
    category: "local",
    tier: "local",
    badge: "Local Image",
    logo: "sdwebui",
    color: "#6366F1",
    monogram: "SD",
    baseUrl: "http://localhost:7860",
    formatType: "openai",
    authStyle: "none",
    docsUrl: "https://github.com/AUTOMATIC1111/stable-diffusion-webui",
    keyOptional: true,
    serviceKinds: ["image"],
    models: ["stable-diffusion-v1-5", "sdxl-base-1.0"]
  },

  // --- Service Providers (Search, Fetch, Audio, Image, Video, Embeddings) ---
  {
    preset: "tavily",
    name: "Tavily Search",
    category: "service",
    tier: "free",
    badge: "Search & Fetch",
    color: "#2563EB",
    monogram: "TV",
    baseUrl: "https://api.tavily.com",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://app.tavily.com/",
    keyOptional: false,
    serviceKinds: ["search", "fetch"],
    models: []
  },
  {
    preset: "brave",
    name: "Brave Search",
    category: "service",
    tier: "free",
    badge: "Search",
    color: "#FB542B",
    monogram: "BS",
    baseUrl: "https://api.search.brave.com/res/v1",
    formatType: "openai",
    authStyle: "x-subscription-token",
    docsUrl: "https://brave.com/search/api/",
    keyOptional: false,
    serviceKinds: ["search"],
    models: []
  },
  {
    preset: "serper",
    name: "Serper.dev",
    category: "service",
    tier: "cheap",
    badge: "Search",
    color: "#3B82F6",
    monogram: "SP",
    baseUrl: "https://google.serper.dev",
    formatType: "openai",
    authStyle: "x-api-key",
    docsUrl: "https://serper.dev/api-key",
    keyOptional: false,
    serviceKinds: ["search"],
    models: []
  },
  {
    preset: "exa",
    name: "Exa AI",
    category: "service",
    tier: "premium",
    badge: "Search & Fetch",
    color: "#1E40AF",
    monogram: "EX",
    baseUrl: "https://api.exa.ai",
    formatType: "openai",
    authStyle: "x-api-key",
    docsUrl: "https://dashboard.exa.ai/api-keys",
    keyOptional: false,
    serviceKinds: ["search", "fetch"],
    models: []
  },
  {
    preset: "firecrawl",
    name: "Firecrawl",
    category: "service",
    tier: "cheap",
    badge: "Web Fetch",
    color: "#F97316",
    monogram: "FC",
    baseUrl: "https://api.firecrawl.dev/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.firecrawl.dev/app/api-keys",
    keyOptional: false,
    serviceKinds: ["fetch"],
    models: []
  },
  {
    preset: "jina",
    name: "Jina AI",
    category: "service",
    tier: "free",
    badge: "Embeddings & Reader",
    color: "#009193",
    monogram: "JN",
    baseUrl: "https://api.jina.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://jina.ai/api-dashboard",
    keyOptional: true,
    serviceKinds: ["embedding", "fetch"],
    models: []
  },
  {
    preset: "deepgram",
    name: "Deepgram",
    category: "service",
    tier: "cheap",
    badge: "STT & TTS",
    color: "#13EF93",
    monogram: "DG",
    baseUrl: "https://api.deepgram.com/v1",
    formatType: "openai",
    authStyle: "token",
    docsUrl: "https://console.deepgram.com/",
    keyOptional: false,
    serviceKinds: ["stt", "tts"],
    models: []
  },
  {
    preset: "assemblyai",
    name: "AssemblyAI",
    category: "service",
    tier: "cheap",
    badge: "Speech-to-Text",
    color: "#2545D3",
    monogram: "AA",
    baseUrl: "https://api.assemblyai.com/v2",
    formatType: "openai",
    authStyle: "authorization",
    docsUrl: "https://www.assemblyai.com/app",
    keyOptional: false,
    serviceKinds: ["stt"],
    models: []
  },
  {
    preset: "elevenlabs",
    name: "ElevenLabs",
    category: "service",
    tier: "premium",
    badge: "TTS & Audio",
    color: "#111827",
    monogram: "EL",
    baseUrl: "https://api.elevenlabs.io/v1",
    formatType: "openai",
    authStyle: "xi-api-key",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    keyOptional: false,
    serviceKinds: ["tts", "stt"],
    models: []
  },
  {
    preset: "fal",
    name: "fal.ai",
    category: "service",
    tier: "cheap",
    badge: "Image & Video",
    color: "#7C3AED",
    monogram: "FA",
    baseUrl: "https://fal.run",
    formatType: "openai",
    authStyle: "key",
    docsUrl: "https://fal.ai/dashboard/keys",
    keyOptional: false,
    serviceKinds: ["image", "video"],
    models: []
  },
  {
    preset: "stability",
    name: "Stability AI",
    category: "service",
    tier: "cheap",
    badge: "Image & Video",
    color: "#9333EA",
    monogram: "ST",
    baseUrl: "https://api.stability.ai/v2beta",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.stability.ai/account/keys",
    keyOptional: false,
    serviceKinds: ["image", "video"],
    models: []
  },
  {
    preset: "bfl",
    name: "Black Forest Labs",
    category: "service",
    tier: "premium",
    badge: "FLUX Image",
    color: "#171717",
    monogram: "BF",
    baseUrl: "https://api.bfl.ai/v1",
    formatType: "openai",
    authStyle: "x-key",
    docsUrl: "https://dashboard.bfl.ai/",
    keyOptional: false,
    serviceKinds: ["image"],
    models: []
  },
  {
    preset: "recraft",
    name: "Recraft",
    category: "service",
    tier: "premium",
    badge: "Image & Vector",
    color: "#EC4899",
    monogram: "RC",
    baseUrl: "https://external.api.recraft.ai/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.recraft.ai/docs",
    keyOptional: false,
    serviceKinds: ["image"],
    models: []
  },
  {
    preset: "runway",
    name: "Runway",
    category: "service",
    tier: "premium",
    badge: "Video & Image",
    color: "#0F172A",
    monogram: "RW",
    baseUrl: "https://api.dev.runwayml.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://dev.runwayml.com/",
    keyOptional: false,
    serviceKinds: ["video", "image"],
    models: []
  },
  {
    preset: "voyage",
    name: "Voyage AI",
    category: "service",
    tier: "cheap",
    badge: "Embeddings",
    color: "#0284C7",
    monogram: "VY",
    baseUrl: "https://api.voyageai.com/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://dash.voyageai.com/api-keys",
    keyOptional: false,
    serviceKinds: ["embedding"],
    models: []
  },
  {
    preset: "searxng",
    name: "SearXNG",
    category: "service",
    tier: "local",
    badge: "Self-Hosted Search",
    color: "#3050FF",
    monogram: "SX",
    baseUrl: "http://localhost:8888",
    formatType: "openai",
    authStyle: "none",
    docsUrl: "https://docs.searxng.org/",
    keyOptional: true,
    serviceKinds: ["search"],
    models: []
  },
  {
    preset: "google-pse",
    name: "Google Programmable Search",
    category: "service",
    tier: "free",
    badge: "Search",
    color: "#4285F4",
    monogram: "GP",
    baseUrl: "https://www.googleapis.com/customsearch/v1",
    formatType: "openai",
    authStyle: "query-key",
    docsUrl: "https://developers.google.com/custom-search/v1/overview",
    keyOptional: false,
    serviceKinds: ["search"],
    models: []
  },
  {
    preset: "linkup",
    name: "Linkup",
    category: "service",
    tier: "cheap",
    badge: "Search",
    color: "#059669",
    monogram: "LU",
    baseUrl: "https://api.linkup.so/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://app.linkup.so/",
    keyOptional: false,
    serviceKinds: ["search"],
    models: []
  },
  {
    preset: "searchapi",
    name: "SearchAPI",
    category: "service",
    tier: "cheap",
    badge: "Search",
    color: "#4F46E5",
    monogram: "SA",
    baseUrl: "https://www.searchapi.io/api/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://www.searchapi.io/",
    keyOptional: false,
    serviceKinds: ["search"],
    models: []
  },
  {
    preset: "cartesia",
    name: "Cartesia",
    category: "service",
    tier: "cheap",
    badge: "TTS",
    logo: "cartesia",
    color: "#4F46E5",
    monogram: "CT",
    baseUrl: "https://api.cartesia.ai",
    formatType: "openai",
    authStyle: "x-api-key",
    docsUrl: "https://play.cartesia.ai/keys",
    keyOptional: false,
    serviceKinds: ["tts"],
    models: []
  },
  {
    preset: "fish-audio",
    name: "Fish Audio",
    category: "service",
    tier: "cheap",
    badge: "TTS",
    logo: "fish-audio",
    color: "#0EA5E9",
    monogram: "FA",
    baseUrl: "https://api.fish.audio/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://fish.audio/app/api-keys/",
    keyOptional: false,
    serviceKinds: ["tts"],
    models: []
  },
  {
    preset: "inworld",
    name: "Inworld TTS",
    category: "service",
    tier: "cheap",
    badge: "TTS",
    logo: "inworld",
    color: "#7C3AED",
    monogram: "IW",
    baseUrl: "https://api.inworld.ai/tts/v1",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://platform.inworld.ai/api-keys",
    keyOptional: false,
    serviceKinds: ["tts"],
    models: []
  },
  {
    preset: "playht",
    name: "PlayHT",
    category: "service",
    tier: "cheap",
    badge: "TTS",
    logo: "playht",
    color: "#10B981",
    monogram: "PH",
    baseUrl: "https://api.play.ht/api/v2",
    formatType: "openai",
    authStyle: "bearer",
    docsUrl: "https://play.ht/studio/api-access",
    keyOptional: false,
    serviceKinds: ["tts"],
    models: []
  },
  {
    preset: "youcom",
    name: "You.com Search",
    category: "service",
    tier: "cheap",
    badge: "Search",
    logo: "youcom",
    color: "#2563EB",
    monogram: "YC",
    baseUrl: "https://api.ydc-index.io",
    formatType: "openai",
    authStyle: "x-api-key",
    docsUrl: "https://api.you.com",
    keyOptional: false,
    serviceKinds: ["search"],
    models: []
  },

  // --- Custom Providers ---
  {
    preset: "custom-openai",
    name: "Custom OpenAI-Compatible",
    category: "custom",
    tier: "premium",
    badge: "Custom",
    color: "#64748B",
    monogram: "CO",
    baseUrl: "",
    formatType: "openai",
    authStyle: "bearer",
    authModes: ["apikey", "json", "oauth_pkce", "device_code"],
    oauthType: "custom_oauth",
    keyOptional: false,
    models: []
  },
  {
    preset: "custom-anthropic",
    name: "Custom Anthropic-Compatible",
    category: "custom",
    tier: "premium",
    badge: "Custom",
    color: "#B45309",
    monogram: "CA",
    baseUrl: "",
    formatType: "anthropic",
    authStyle: "x-api-key",
    authModes: ["apikey", "json", "oauth_pkce", "device_code"],
    oauthType: "custom_oauth",
    keyOptional: false,
    models: []
  },
  {
    preset: "custom",
    name: "Custom",
    category: "custom",
    tier: "premium",
    badge: "Custom",
    color: "#475569",
    monogram: "CU",
    baseUrl: "",
    formatType: "openai",
    authStyle: "bearer",
    authModes: ["apikey", "json", "oauth_pkce", "device_code"],
    oauthType: "custom_oauth",
    keyOptional: false,
    models: []
  },
  // --- Self-hosted Media & Embeddings (9Router parity) ---
  {
    preset: "self-hosted-stt",
    name: "Self-hosted STT (Whisper)",
    category: "local",
    tier: "local",
    badge: "Self-Hosted",
    logo: "local-device",
    color: "#0EA5E9",
    monogram: "ST",
    baseUrl: "http://localhost:8080/v1",
    formatType: "openai",
    authStyle: "bearer",
    serviceKinds: ["stt"],
    docsUrl: "https://github.com/ggml-org/whisper.cpp",
    keyOptional: true,
    models: ["whisper-1", "whisper-large-v3-turbo"]
  },
  {
    preset: "self-hosted-tts",
    name: "Self-hosted TTS (Kokoro)",
    category: "local",
    tier: "local",
    badge: "Self-Hosted",
    logo: "local-device",
    color: "#8B5CF6",
    monogram: "TT",
    baseUrl: "http://localhost:8880/v1",
    formatType: "openai",
    authStyle: "bearer",
    serviceKinds: ["tts"],
    docsUrl: "https://github.com/remsky/Kokoro-FastAPI",
    keyOptional: true,
    models: ["kokoro", "tts-1"]
  },
  {
    preset: "self-hosted-embedding",
    name: "Self-hosted Embedding",
    category: "local",
    tier: "local",
    badge: "Self-Hosted",
    logo: "local-device",
    color: "#10B981",
    monogram: "EM",
    baseUrl: "http://localhost:8080/v1",
    formatType: "openai",
    authStyle: "bearer",
    serviceKinds: ["embedding"],
    docsUrl: "https://github.com/ggml-org/llama.cpp",
    keyOptional: true,
    models: ["nomic-embed-text", "bge-m3", "text-embedding-3-small"]
  }
];

export const PRESETS = RAW_PRESETS.map(enrichPresetWithCatalog);

/**
 * Rebuild all enriched PRESETS entries in-place after `modelCatalog.json` is updated.
 */
export function refreshPresets() {
  const next = RAW_PRESETS.map(enrichPresetWithCatalog);
  PRESETS.splice(0, PRESETS.length, ...next);
  return PRESETS;
}

onCatalogReload(refreshPresets);

export const VALID_FORMAT_TYPES = new Set(["openai", "anthropic", "gemini-openai"]);

/**
 * Look up a preset definition by id/preset key.
 * @param {string} presetId
 */
export function getPreset(presetId) {
  return PRESETS.find((p) => p.preset === presetId || p.id === presetId) || null;
}

/**
 * Normalize a provider baseUrl by trimming whitespace and stripping trailing slashes.
 * @param {string} url
 * @returns {string}
 */
export function normalizeBaseUrl(url) {
  if (typeof url !== "string") return "";
  return url.trim().replace(/\/+$/, "");
}

/**
 * Validate whether a string is a valid HTTP or HTTPS URL.
 * @param {string} url
 * @returns {boolean}
 */
export function isValidHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Check whether a URL points to a loopback/local host (for keyless local LLM support).
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host === "0.0.0.0"
    );
  } catch {
    return false;
  }
}

/**
 * Check whether a provider is allowed to operate without an upstream API key
 * (either its preset sets `keyOptional: true` or its `baseUrl` is a local loopback URL).
 * @param {{ preset?: string, baseUrl?: string } | null | undefined} provider
 * @returns {boolean}
 */
export function isKeyOptionalProvider(provider) {
  if (!provider) return false;
  const presetDef = getPreset(provider.preset);
  if (presetDef?.keyOptional === true) {
    return true;
  }
  return isLocalUrl(provider.baseUrl);
}

/**
 * Build an upstream endpoint URL cleanly for either OpenAI-style or Anthropic-style baseUrls.
 * Handles Anthropic baseUrls with or without trailing `/v1`.
 * @param {string} baseUrl
 * @param {string} formatType
 * @param {string} path
 * @returns {string}
 */
export function buildUpstreamUrl(baseUrl, formatType, path) {
  const clean = normalizeBaseUrl(baseUrl);
  const cleanPath = path.replace(/^\/+/, "");
  if (formatType === "anthropic") {
    if (clean.endsWith("/v1")) {
      return `${clean}/${cleanPath}`;
    }
    return `${clean}/v1/${cleanPath}`;
  }
  return `${clean}/${cleanPath}`;
}
