# 001Router for VS Code & Antigravity IDE

Official IDE extension for **001Router** — connect your IDE directly to your personal or team 001Router gateway with web-password verification, 2-step Provider -> Model switching, and a dynamic power-scaling Effort slider.

## Features

- **Password-Verified Web Connection**: Enter your 001Router Web URL (`http://127.0.0.1:20128` or your deployed Vercel/VPS domain) and your **001Router dashboard password** to automatically authenticate and provision a secure router key in IDE SecretStorage.
- **2-Step Provider -> Model Selector**: Browse your live connected Providers (`OpenAI`, `Anthropic`, `Antigravity`, `Google Gemini`, `DeepSeek`, `Groq`, Combos, Aliases) first, then pick any enabled model from that provider.
- **Dynamic Power-Scaling Effort Slider**: Effort stops (`Low`, `Medium`, `High`, `XHigh` / `Max`) adapt dynamically to the selected provider and model, with progressive color & energy glow transitions as compute effort rises.
- **Full Coding Assistant Workspace**: Open in the Sidebar or Editor Tab (`Ctrl+Esc` to focus/unfocus), attach active files/selections (`+`), use slash commands (`/`), inspect reasoning traces, and copy/apply code edits directly in your editor.

## Quick Install (`.vsix`)

1. Open **Antigravity IDE** or **VS Code**
2. Open the **Extensions** sidebar (`Ctrl+Shift+X`)
3. Click **`...` (Views and More Actions)** -> **Install from VSIX...**
4. Select `001router-code-1.1.0.vsix`

Or via CLI:
```bash
code --install-extension 001router-code-1.1.0.vsix
```

## Publishing to the Community (Open VSX & VS Code Marketplace)

### 1. Open VSX Registry (default marketplace for Antigravity IDE, Cursor, VSCodium)
1. Create a namespace & Personal Access Token at https://open-vsx.org
2. Run:
```bash
npm run package:vsix
npx ovsx publish 001router-code-1.1.0.vsix -p <YOUR_OPEN_VSX_TOKEN>
```

### 2. Visual Studio Code Marketplace
1. Create a publisher (`001router`) & Azure DevOps PAT at https://marketplace.visualstudio.com/manage
2. Run:
```bash
npx @vscode/vsce publish -p <YOUR_VSCE_PAT>
```
