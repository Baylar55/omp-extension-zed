# @baylarsadigov/omp-zed

> Use your **Zed Pro** & **Zed for Students** subscription models directly inside **Oh My Pi (OMP)**.

---

## 📦 Installation

Install directly into Oh My Pi from GitHub using the OMP Marketplace:

### Option 1: From the Terminal (CLI)

```bash
omp plugin marketplace add Baylar55/omp-zed
omp plugin install zed@omp-zed
```

### Option 2: Inside an Active OMP Session (Interactive)

```text
/marketplace add Baylar55/omp-zed
/marketplace install zed@omp-zed
```

---

## 🔑 Authentication

Once installed, authenticate your Zed account inside OMP using either:

1. **Interactive Slash Command**:
   ```text
   /login zed
   ```
   *(Or `/zed login`)*
   This will open your browser to authorize your account.
2. **Environment Variable**:
   You can also set your token or session cookie as an environment variable:
   ```bash
   export ZED_AUTH_TOKEN="your_token_here"
   ```

---

## 🛠️ Slash Commands

| Command | Description |
| :--- | :--- |
| `/zed usage` | Show monthly usage, credit limits, and quota meter |
| `/zed sync` | Auto-sync live dollar spend from browser session (no DevTools needed) |
| `/zed status` | Display connection status and active Zed account |
| `/zed models` | List all available Zed Pro / Student models |
| `/zed login` | Trigger browser authentication / re-login flow |
| `/zed logout` | Remove stored Zed credentials |
| `/zed set-spend` | Set your baseline monthly dollar spend (e.g. `/zed set-spend 1.90`) |
| `/zed set-token` | Manually save an access token |
| `/zed set-cookie` | Manually save a zed.session cookie |
| `/zed reset-usage`| Reset local spend counter to $0.00 |
