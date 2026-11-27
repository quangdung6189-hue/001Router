# 001Router for VS Code & Antigravity IDE

Official autonomous AI coding extension for **001Router** — powered by **Axiom**, featuring an interactive **Grok-style 3D Singularity Core**, a **Cline-grade live execution trace**, **Claude-style radiant gliding Effort control**, **multi-project & No-Project free-chat switching**, and granular **Terminal / File / Web permissions**.

## Highlights in v1.6.0

- **Grok-Inspired 3D Singularity Core**: Real-time interactive 60fps HiDPI 3D orbital accretion core (`media/grok3d.js`) with drag-to-spin inertia, pointer tilt, Fibonacci neural lattice, and mood-reactive energy palettes (respects `prefers-reduced-motion` + `Pause 3D FX`).
- **Claude-Style Radiant Gliding Effort Slider**: Continuous 60fps gliding capsule (`Low → Med → High → XHigh / Max`) with `linear()` spring detents, kinetic intensity bars, prismatic singularity glow, and accurate effort routing across Anthropic, OpenAI, Antigravity, Gemini, OpenRouter, DeepSeek, Qwen, GLM, and Kimi.
- **Multi-Project Switcher & No-Project Free Chat**: Switch between any project folder on disk (OS folder picker, direct path input, or nearby code projects) without reopening your IDE, attach arbitrary files from your computer, or switch to **`No Project · Chat tự do`** for completely isolated general chat that never touches any repository.
- **Cline-Grade Autonomous Agent & Compact Engineer Trace**: 12 built-in tools (`list_files`, `read_file`, `search_files`, `write_to_file`, `replace_in_file`, `delete_file`, `execute_command`, `get_diagnostics`, `git_info`, `web_fetch`, `open_file`, `update_plan`), anti-corruption SSE parser, automatic transient error retries, live Terminal output, inline diffs, and compact trace rows.
- **Granular Permission Matrix (`/permissions`)**: 3 one-click presets (`Toàn quyền / YOLO`, `An toàn`, `Hỏi duyệt`), 9 individual toggles, catastrophic command protection, configurable step limits (`15 / 35 / 60 / ∞`), and inline approval cards.
- **Zero-Reset Scroll & Fluid Responsive UI**: Partitioned DOM keeps chat scroll locked across all controls, while CSS Container Queries adapt seamlessly from ultra-narrow sidebars to full-width editor tabs.

## Quick Install

Install directly from **Open VSX Registry** (`001router.001router-code`) inside **Antigravity IDE / Cursor / Windsurf / VSCodium**, or install the `.vsix` manually:

1. Open **Antigravity IDE** or **VS Code**
2. Open **Extensions** (`Ctrl+Shift+X`) → **`...`** → **Install from VSIX...**
3. Select `001router-code-1.6.0.vsix`

Or via CLI:
```bash
code --install-extension 001router-code-1.6.0.vsix
```

## Publishing to Open VSX

```bash
npm run package:vsix
ovsx publish 001router-code-1.6.0.vsix -p <YOUR_OPEN_VSX_TOKEN>
```
