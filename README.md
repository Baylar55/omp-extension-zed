# @baylarsadigov/omp-extension-zed

> Use your **Zed Pro** & **Zed for Students** subscription models directly inside **Oh My Pi (OMP)**.

---

## 🚀 Features

- **Seamless Provider Integration**: Registers the `zed/` provider in OMP with one-click model access.
- **Complete Model Catalog (16 Models Supported)**:
  - **Anthropic Claude Series**:
    - `zed/claude-sonnet-5` *(Latest, 1M context)*
    - `zed/claude-sonnet-4-6` *(1M context)*
    - `zed/claude-sonnet-4-5` *(200k context)*
    - `zed/claude-haiku-4-5` *(200k context)*
  - **OpenAI GPT Series**:
    - `zed/gpt-5.6-sol` *(Latest reasoning model, 400k context)*
    - `zed/gpt-5.6-terra` *(Latest, 400k context)*
    - `zed/gpt-5.6-luna` *(Latest, 400k context)*
    - `zed/gpt-5.5` *(400k context)*
    - `zed/gpt-5.4` *(400k context)*
    - `zed/gpt-5.3-codex` *(400k context)*
    - `zed/gpt-5.2` *(400k context)*
    - `zed/gpt-5-mini` *(400k context)*
    - `zed/gpt-5-nano` *(400k context)*
  - **Google Gemini Series**:
    - `zed/gemini-3.1-pro` *(Latest, 200k context)*
    - `zed/gemini-3.5-flash` *(Latest, 1M context)*
    - `zed/gemini-3-flash` *(1M context)*
- **Built-in Token & Usage Tracker**: Run `/zed usage` or `/zed status` inside OMP to track your monthly credit consumption, remaining quota, and billing cycle.
- **Flexible Auth**: Support for browser OAuth login, local Credential Manager detection, or manual session token input.
- **Zero Heavy Dependencies**: Uses lightweight native Node.js HTTP/fetch primitives with minimal memory footprint.

---

## 📦 Installation

### As an OMP Extension

Install using OMP's plugin/extension link or add to your `~/.omp/agent/config.yml`:

```yaml
# ~/.omp/agent/config.yml
extensions:
  - path: "C:/Users/user/Desktop/Projects/omp-extension-zed"
```

Or link directly via OMP:
```bash
omp plugin link C:/Users/user/Desktop/Projects/omp-extension-zed
```

---

## 🔑 Authentication

Authenticate your Zed account inside OMP using either:

1. **Interactive Slash Command**:
   ```text
   /zed login
   ```
   Or standard OMP login:
   ```text
   /login zed
   ```
2. **Environment Variable**:
   Set `ZED_AUTH_TOKEN` or `ZED_SESSION_COOKIE`:
   ```bash
   export ZED_AUTH_TOKEN="your_token_here"
   ```

---

## 📊 Checking Usage & Quota

Inside any OMP session, run:
```text
/zed usage
```
This displays:
- Total monthly credit allowance ($10.00 on Student plan)
- Consumed credits and percentage
- Billing period reset date
- Per-model token breakdown (input, output, and cache)

---

## 🛠️ Slash Commands

| Command | Description |
| :--- | :--- |
| `/zed usage` | Show live token consumption and remaining quota |
| `/zed status` | Display connection status and active Zed account |
| `/zed models` | List all available Zed Pro / Student models |
| `/zed login` | Trigger authentication / re-login flow |
| `/zed logout` | Remove stored Zed credentials |
| `/zed set-token` | Manually save an access token |
| `/zed set-cookie` | Manually save a zed.session cookie |

---

## 📄 License

MIT © Baylar Sadigov
