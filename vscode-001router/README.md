# 001Router for VS Code & Antigravity IDE

Official IDE extension for **001Router** — powered by **Axiom**, an expressive animated systems-architect companion with full opened-project folder awareness, workspace tool calling, unified multi-provider model switching, and an ethereal 4-realm Effort engine.

## Highlights in v1.3.0

- **Full Project Folder Awareness & Live Workspace Tools**: Automatically scans your opened Workspace Folder (or auto-detects project root markers like `.git`, `package.json`, `Cargo.toml`, `pyproject.toml`), injects the project directory tree and smartly hydrated project files, and equips Axiom with live read-only workspace tools (`list_workspace_files`, `read_workspace_file`, `search_workspace_text`) with safe automatic fallback.
- **Axiom — Expressive Animated Companion Bot**: Interactive SVG bot avatar with live facial expressions, cursor gaze tracking, attentive listening while typing, scanning optics when reading project files, voice-waveform mouth during streaming, and clean clutter-free message headers.
- **Modern Systems Architect UI & Geometric Icons**: Obsidian-graphite surfaces, precision geometric SVG icons, dual Workspace Folder + Active File context dock, and a built-in Workspace Tree Inspector popover.
- **Ethereal 4-Realm Effort Engine (`Low → Med → High → XHigh / Max`)**: Smooth 60fps native range slider with Emerald Aether, Astral Sapphire, Solar Supernova, and Celestial Black Hole Singularity realms plus radial shockwave bursts on tier transitions and accurate effort routing across Anthropic, OpenAI, Antigravity, Gemini, OpenRouter, DeepSeek, Qwen, GLM, and Kimi.

## Quick Install (`.vsix`)

1. Open **Antigravity IDE** or **VS Code**
2. Open the **Extensions** sidebar (`Ctrl+Shift+X`)
3. Click **`...` (Views and More Actions)** -> **Install from VSIX...**
4. Select `001router-code-1.3.0.vsix`

Or via CLI:
```bash
code --install-extension 001router-code-1.3.0.vsix
```

## Publishing (Open VSX & VS Code Marketplace)

```bash
npm run package:vsix
npx ovsx publish 001router-code-1.3.0.vsix -p <YOUR_OPEN_VSX_TOKEN>
```
