/**
 * Agent Skills metadata & dynamic SKILL.md renderer matching 9Router's /dashboard/skills page.
 */

export const AGENT_SKILLS = [
  {
    id: "001router",
    name: "001Router (Entry)",
    description:
      "Setup + index of all capabilities. Start here — covers base URL, auth, model discovery, and links to every capability skill.",
    endpoint: null,
    icon: "hub",
    isEntry: true
  },
  {
    id: "001router-chat",
    name: "Chat & Coding",
    description:
      "Chat / code-gen via OpenAI (/v1/chat/completions), Anthropic (/v1/messages), OpenAI Responses (/v1/responses), or Gemini (/v1beta/models).",
    endpoint: "/v1/chat/completions",
    icon: "chat"
  },
  {
    id: "001router-image",
    name: "Image Generation",
    description: "Text-to-image via DALL-E, Imagen, FLUX, MiniMax, Recraft, Together, Fireworks…",
    endpoint: "/v1/images/generations",
    icon: "image"
  },
  {
    id: "001router-tts",
    name: "Text-to-Speech",
    description: "OpenAI / ElevenLabs / Deepgram / Self-hosted TTS voices with audio streaming.",
    endpoint: "/v1/audio/speech",
    icon: "tts"
  },
  {
    id: "001router-stt",
    name: "Speech-to-Text",
    description: "Transcribe audio via OpenAI Whisper, Groq, Deepgram, AssemblyAI, Self-hosted STT…",
    endpoint: "/v1/audio/transcriptions",
    icon: "stt"
  },
  {
    id: "001router-embeddings",
    name: "Embeddings",
    description: "Vectors for RAG / semantic search via OpenAI, Gemini, Voyage, Jina, Mistral, Self-hosted…",
    endpoint: "/v1/embeddings",
    icon: "embeddings"
  },
  {
    id: "001router-web-search",
    name: "Web Search",
    description: "Unified web search via Tavily, Exa, Brave, Serper, Linkup, SearchAPI, Google PSE, SearXNG.",
    endpoint: "/v1/search",
    icon: "search"
  },
  {
    id: "001router-web-fetch",
    name: "Web Fetch",
    description: "URL → clean Markdown / text extraction via Firecrawl, Jina Reader, Tavily, Exa.",
    endpoint: "/v1/web/fetch",
    icon: "fetch"
  }
];

/**
 * Render dynamic SKILL.md content pre-populated with the user's running origin.
 * @param {string} skillId
 * @param {string} origin
 * @returns {string | null}
 */
export function renderSkillMarkdown(skillId, origin = "http://localhost:20128") {
  const base = String(origin || "http://localhost:20128").replace(/\/+$/, "");
  const v1 = `${base}/v1`;
  const skill = AGENT_SKILLS.find((s) => s.id === skillId);
  if (!skill) return null;

  if (skill.id === "001router") {
    return `---
name: 001router
description: Connect to the local 001Router AI Gateway (${v1}) for multi-provider chat, fallback combos, embeddings, images, TTS, STT, web search, and web fetch.
---

# 001Router Local AI Gateway

- **OpenAI Base URL:** \`${v1}\`
- **Anthropic Base URL:** \`${base}\`
- **Auth Header:** \`Authorization: Bearer <YOUR_ROUTER_KEY>\` (or \`x-api-key: <YOUR_ROUTER_KEY>\`)
- **Bypass Token Savers per request:** \`X-9Router-Token-Saver: off\`

## Discover Available Models & Combos

\`\`\`bash
curl ${v1}/models \\
  -H "Authorization: Bearer $ROUTER_KEY"
\`\`\`

Filter by service kind: \`?kind=chat\`, \`?kind=vision\`, \`?kind=embedding\`, \`?kind=image\`, \`?kind=tts\`, \`?kind=stt\`, \`?kind=search\`, \`?kind=fetch\`.

## Capability Skills

${AGENT_SKILLS.filter((s) => !s.isEntry)
  .map((s) => `- **${s.name}** (\`${s.endpoint}\`): ${base}/api/skills/${s.id}/SKILL.md`)
  .join("\n")}
`;
  }

  const examples = {
    "001router-chat": `\`\`\`bash
curl ${v1}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ROUTER_KEY" \\
  -d '{
    "model": "3-tier-auto",
    "messages": [{"role": "user", "content": "Explain quicksort in 3 lines"}]
  }'
\`\`\`

Also supports Anthropic \`POST ${v1}/messages\`, OpenAI Responses \`POST ${v1}/responses\`, and Gemini \`POST ${base}/v1beta/models/<provider>/<model>:generateContent\`.`,
    "001router-image": `\`\`\`bash
curl ${v1}/images/generations \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ROUTER_KEY" \\
  -d '{
    "model": "openai/gpt-image-1",
    "prompt": "Minimalist isometric illustration of an AI router hub",
    "size": "1024x1024"
  }'
\`\`\``,
    "001router-tts": `\`\`\`bash
curl ${v1}/audio/speech \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ROUTER_KEY" \\
  -d '{
    "model": "openai/tts-1",
    "voice": "alloy",
    "input": "Hello from 001Router!"
  }' --output speech.mp3
\`\`\`

List voices: \`GET ${v1}/audio/voices\`.`,
    "001router-stt": `\`\`\`bash
curl ${v1}/audio/transcriptions \\
  -H "Authorization: Bearer $ROUTER_KEY" \\
  -F "model=groq/whisper-large-v3-turbo" \\
  -F "file=@audio.mp3"
\`\`\``,
    "001router-embeddings": `\`\`\`bash
curl ${v1}/embeddings \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ROUTER_KEY" \\
  -d '{
    "model": "openai/text-embedding-3-small",
    "input": "Semantic vector search with 001Router"
  }'
\`\`\``,
    "001router-web-search": `\`\`\`bash
curl ${v1}/search \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ROUTER_KEY" \\
  -d '{
    "query": "latest Node.js LTS release",
    "max_results": 5
  }'
\`\`\``,
    "001router-web-fetch": `\`\`\`bash
curl ${v1}/web/fetch \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $ROUTER_KEY" \\
  -d '{
    "url": "https://nodejs.org/en"
  }'
\`\`\``
  };

  return `---
name: ${skill.id}
description: ${skill.description}
---

# ${skill.name} via 001Router

- **Endpoint:** \`POST ${base}${skill.endpoint}\`
- **Auth:** \`Authorization: Bearer <YOUR_ROUTER_KEY>\`

## Example Request

${examples[skill.id] || ""}
`;
}
