# 001Router — AI Router Cục Bộ (Local Gateway)

**001Router** là một AI Router / Gateway chạy trực tiếp trên máy chủ cục bộ (`http://localhost:20128`), tương thích cả chuẩn **OpenAI** (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`) lẫn chuẩn **Anthropic** (`/v1/messages`, `/v1/messages/count_tokens`).

> **Lưu ý quan trọng về chính sách & bảo mật:**  
> 001Router **chỉ hỗ trợ Official API Keys chính thức** từ các nhà cung cấp (OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Ollama/LM Studio, v.v.).  
> Ứng dụng **không** sử dụng OAuth/subscription hijacking, **không** giả mạo fingerprint/header của client thứ ba và hoàn toàn không can thiệp trái phép vào dịch vụ của nhà cung cấp.

---

## Tính năng chính

- **1 Endpoint thống nhất (`http://localhost:20128/v1`):** Kết nối mọi công cụ coding AI về một đầu mối duy nhất.
- **Tương thích hai chiều OpenAI ⇄ Anthropic:** Tự động dịch request/response (gồm cả SSE streaming, `tool_use` / `tool_calls`, `tool_result`, thinking/reasoning) giữa chuẩn Claude và chuẩn OpenAI.
- **Quản lý nhiều Provider & xoay vòng API Key:** Hỗ trợ 13 preset sẵn (OpenAI, Anthropic, Google Gemini OpenAI-compat, OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Cerebras, Ollama, LM Studio, Custom), tự động round-robin nhiều key và cho key vào cooldown 60 giây khi gặp lỗi `429` hoặc `401`.
- **Combo Fallback thông minh:** Tạo alias (ví dụ `best-coder`) trỏ tới danh sách `provider/model` theo thứ tự ưu tiên; tự động chuyển sang model dự phòng khi gặp `429`, `5xx`, timeout hoặc lỗi mạng (chỉ fallback trước khi stream gửi byte đầu tiên).
- **Token Saver (nén ngữ cảnh kiểu RTK):** Tự động rút gọn output của tool (`tool` / `tool_result`) và prompt dài để tiết kiệm token, ghi nhận số ký tự đã tiết kiệm trong Usage & Logs.
- **Dashboard trực quan & Playground:** Quản lý Router Key, theo dõi biểu đồ Usage/Logs (giữ tối đa 5.000 log gần nhất), thử nghiệm chat trực tiếp (Playground), tạo snippet cấu hình nhanh cho từng công cụ, và Import/Export cấu hình JSON.

---

## Yêu cầu hệ thống & Khởi chạy

- **Node.js** `>= 20` (khuyến nghị Node 22/24) và **npm**.

### Cách 1: Nhấp đúp file `start.bat` (Windows)
Mở thư mục `app` và chạy file `start.bat`. Script sẽ tự động cài đặt gói còn thiếu (nếu có), build giao diện web và khởi chạy server tại `http://localhost:20128`.

### Cách 2: Chạy bằng dòng lệnh (Terminal / PowerShell)

```bash
cd app
npm install
npm --prefix web install
npm run build
npm start
```

Các lệnh hữu ích khác:
- `npm run dev` — Chạy server ở chế độ theo dõi file (`node --watch server/index.js`).
- `npm run dev:web` — Chạy Vite dev server cho giao diện web (proxy `/api` và `/v1` sang cổng `20128`).
- `npm test` — Chạy bộ kiểm thử tự động (`node --test`).

---

## Đăng nhập Dashboard lần đầu

1. Truy cập: **`http://localhost:20128`**
2. Mật khẩu mặc định lần đầu: **`1234`** — hãy đổi ngay. Mật khẩu mới phải dài **8–72 ký tự** và không được là mật khẩu phổ biến (`1234`, `12345678`, `password`…).
   - Lần đăng nhập đầu bằng `1234`, dashboard **bắt buộc** đổi mật khẩu mới được dùng (mọi API khác trả `403 PASSWORD_CHANGE_REQUIRED`). Đặt `ROUTER001_ALLOW_DEFAULT_PASSWORD=1` nếu cần tắt (không khuyến nghị).
   - **Master key:** mặc định lưu ở `data/.master.key` cạnh `db.json`. Để tách khỏi dữ liệu, đặt `ROUTER001_MASTER_KEY` (64 ký tự hex, dùng đúng giá trị trong file hiện tại để vẫn giải mã được dữ liệu cũ) rồi chuyển file `.master.key` ra ngoài thư mục data. Mục *Master Key Separation* trong Security Scan sẽ chuyển sang PASS.
   - **Reverse proxy:** đặt `ROUTER001_TRUST_PROXY=1` (số hop) để khoá đăng nhập tính theo IP thật của client thay vì IP của proxy. Không đặt = không tin header `X-Forwarded-*`.
   - Khi server bind vào loopback (mặc định `127.0.0.1`), chỉ chấp nhận `Host` là `localhost` / `127.x.x.x` / `::1` (chống DNS-rebinding). Nếu truy cập qua reverse proxy / tên miền riêng, khai báo: `ROUTER001_ALLOWED_HOSTS=router.example.com,other.host` (phân cách bằng dấu phẩy).
3. Sau khi đăng nhập, vào mục **Settings** để đổi mật khẩu mới. Mật khẩu được băm an toàn bằng `bcryptjs` và lưu trong `app/data/db.json`.
4. Trên trang chủ (**Endpoint & Keys**), bạn sẽ thấy sẵn một **Router API Key** mặc định dạng `sk-001r-...` để sử dụng ngay (có thể tạo thêm hoặc thu hồi bất cứ lúc nào).

---

## Hướng dẫn kết nối các công cụ AI

Bạn cũng có thể vào trang **Integrations** ngay trong Dashboard để copy nhanh cấu hình đã điền sẵn host và Router Key.

### 1. Claude Code
Đặt biến môi trường trước khi chạy `claude`:

```powershell
# PowerShell (Windows)
$env:ANTHROPIC_BASE_URL = "http://localhost:20128"
$env:ANTHROPIC_AUTH_TOKEN = "sk-001r-YOUR_ROUTER_KEY"
$env:ANTHROPIC_MODEL = "best-coder" # hoặc anthropic/claude-sonnet-4-5, openai/gpt-4o...
claude
```

```bash
# Bash / Zsh
export ANTHROPIC_BASE_URL="http://localhost:20128"
export ANTHROPIC_AUTH_TOKEN="sk-001r-YOUR_ROUTER_KEY"
export ANTHROPIC_MODEL="best-coder"
claude
```

### 2. Codex CLI
Thêm custom provider vào `~/.codex/config.toml`:

```toml
model_provider = "router001"
model = "best-coder"

[model_providers.router001]
name = "001Router"
base_url = "http://localhost:20128/v1"
env_key = "ROUTER001_API_KEY"
wire_api = "chat"
```

Và đặt biến môi trường `ROUTER001_API_KEY="sk-001r-YOUR_ROUTER_KEY"`.

### 3. Cursor
1. Mở **Settings → Models → API Keys**.
2. Bật **OpenAI API Key** và dán Router Key (`sk-001r-...`).
3. Bật **Override OpenAI Base URL** và nhập: `http://localhost:20128/v1`.
4. Thêm tên model hoặc tên Combo (ví dụ `best-coder`, `openai/gpt-4o`).

### 4. Cline / Roo Code (VS Code)
- **API Provider:** `OpenAI Compatible`
- **Base URL:** `http://localhost:20128/v1`
- **API Key:** `sk-001r-YOUR_ROUTER_KEY`
- **Model ID:** tên Combo hoặc `<providerSlug>/<modelId>`

### 5. Continue (`~/.continue/config.yaml`)
```yaml
models:
  - name: 001Router (Combo)
    provider: openai
    model: best-coder
    apiBase: http://localhost:20128/v1
    apiKey: sk-001r-YOUR_ROUTER_KEY
```

### 6. OpenCode (`opencode.json`)
```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "router001": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "001Router",
      "options": {
        "baseURL": "http://localhost:20128/v1",
        "apiKey": "sk-001r-YOUR_ROUTER_KEY"
      },
      "models": {
        "best-coder": { "name": "Best Coder Combo" }
      }
    }
  }
}
```

### 7. Aider
```bash
export OPENAI_API_BASE="http://localhost:20128/v1"
export OPENAI_API_KEY="sk-001r-YOUR_ROUTER_KEY"
aider --model openai/best-coder
```

### 8. OpenAI SDK / cURL
```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-001r-YOUR_ROUTER_KEY" \
  -d '{
    "model": "best-coder",
    "messages": [{"role": "user", "content": "Hello from 001Router!"}]
  }'
```

---

## Lưu ý bảo mật

- Toàn bộ dữ liệu cục bộ được lưu tại `app/data/db.json` (đã được thêm vào `.gitignore`).
- Các API Key của Provider luôn được che (`sk-…abcd`) trên giao diện và API đọc danh sách.
- Chức năng **Export Config JSON** trong mục Settings có chứa API key gốc để tiện sao lưu — tuyệt đối không chia sẻ file export cho người khác.
