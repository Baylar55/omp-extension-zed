import { deleteCredentialsFile, loadCredentials, maskSecret, saveCredentials } from "../auth/credential-store.js";
import { openBrowser, startOAuthFlow } from "../auth/oauth.js";
import { ZED_MODELS } from "../models.js";
import { fetchZedUsage, formatUsageSummary, resetLocalSpendHistory, setLocalSpendAmount } from "../usage/tracker.js";
export function registerZedCommands(pi) {
    const handlers = {
        usage: async (_a, ctx) => {
            ctx.ui.notify("Fetching live usage from Zed Cloud...", "info");
            const creds = loadCredentials();
            if (!creds || (!creds.accessToken && !creds.sessionCookie)) {
                ctx.ui.notify("No Zed credentials found. Please run '/zed login' to connect your Zed account.", "warning");
                return;
            }
            const report = await fetchZedUsage(creds);
            if (report?.username && !creds.githubUsername)
                saveCredentials({ ...creds, githubUsername: report.username, userId: report.userId || creds.userId });
            ctx.ui.notify(formatUsageSummary(report), "info");
        },
        status: async (_a, ctx) => {
            const creds = loadCredentials();
            if (!creds || (!creds.accessToken && !creds.sessionCookie)) {
                ctx.ui.notify("Zed Status: Disconnected (No credentials stored). Run '/zed login'.", "warning");
                return;
            }
            const user = creds.githubUsername || creds.userId || "Authenticated User";
            const src = creds.source === "system_keychain" ? "System Keychain / Credential Manager (Auto-detected)" : creds.source === "env" ? "Environment Variable" : "Saved Auth File";
            ctx.ui.notify([`🔌 Zed Pro Status: Connected`, `User:          ${user}`, `Source:        ${src}`, `Access Token:  ${maskSecret(creds.accessToken)}`, `Session Cookie:${maskSecret(creds.sessionCookie)}`, `Saved At:      ${creds.savedAt ? new Date(creds.savedAt).toLocaleString() : "Unknown"}`].join("\n"), "info");
        },
        models: async (_a, ctx) => {
            ctx.ui.notify(`📋 Available Zed Models:\n${ZED_MODELS.map((m) => `• zed/${m.id} (${m.name}) - Context: ${(m.contextWindow / 1000).toFixed(0)}k tokens`).join("\n")}`, "info");
        },
        login: async (_a, ctx) => {
            ctx.ui.notify("Starting Zed authentication in browser...", "info");
            try {
                const c = await startOAuthFlow();
                ctx.ui.notify(`✓ Successfully logged in as ${c.githubUsername || "Zed User"}!`, "info");
            }
            catch (e) {
                ctx.ui.notify(`Authentication failed: ${e instanceof Error ? e.message : String(e)}`, "error");
            }
        },
        logout: async (_a, ctx) => {
            ctx.ui.notify(deleteCredentialsFile() ? "✓ Successfully logged out from Zed. Credentials removed." : "No active Zed credentials found to remove.", "info");
        },
        "set-token": async (args, ctx) => {
            const token = args.replace(/^set-token\s+/i, "").trim();
            if (!token) {
                ctx.ui.notify("Usage: /zed set-token <your_token>", "warning");
                return;
            }
            saveCredentials({ accessToken: token });
            ctx.ui.notify("✓ Token saved successfully!", "info");
        },
        "set-cookie": async (args, ctx) => {
            const cookie = args.replace(/^set-cookie\s+/i, "").trim();
            if (!cookie) {
                ctx.ui.notify("Usage: /zed set-cookie <your_session_cookie>", "warning");
                return;
            }
            saveCredentials({ sessionCookie: cookie });
            ctx.ui.notify("✓ Session cookie saved successfully! Live dashboard sync enabled.", "info");
        },
        "set-spend": async (args, ctx) => {
            const amount = parseFloat(args.replace(/^set-spend\s+/i, "").replace(/^\$/, "").trim());
            if (isNaN(amount) || amount < 0) {
                ctx.ui.notify("Usage: /zed set-spend <amount_in_usd> (e.g. /zed set-spend 0.53)", "warning");
                return;
            }
            setLocalSpendAmount(amount);
            ctx.ui.notify(`✓ Current spend set to $${amount.toFixed(2)}.`, "info");
        },
        sync: async (_a, ctx) => {
            openBrowser("https://dashboard.zed.dev");
            ctx.ui.notify(["Opened https://dashboard.zed.dev in your browser.", "1. Log in on dashboard.zed.dev if needed.", "2. Copy your zed.session cookie and run '/zed set-cookie <value>' if you need live billing."].join("\n"), "info");
        },
        "reset-usage": async (_a, ctx) => { resetLocalSpendHistory(); ctx.ui.notify("✓ Local usage spend count has been reset to $0.00.", "info"); },
    };
    pi.registerCommand("zed", {
        description: "Manage Zed Pro / Student subscription models, authentication, and usage",
        handler: async (args, ctx) => {
            const cmd = args.trim().toLowerCase().split(/\s+/)[0] || "help";
            const fn = handlers[cmd];
            if (fn)
                await fn(args, ctx);
            else
                ctx.ui.notify([`⚡ Zed Extension Commands:`, `• /zed usage       - View monthly credit usage & quota meter`, `• /zed sync        - Open dashboard.zed.dev to copy session cookie (manual)`, `• /zed status      - View authentication & connection status`, `• /zed models      - List all accessible Zed models`, `• /zed login       - Connect your Zed account via browser`, `• /zed logout      - Remove stored Zed credentials`, `• /zed set-token   - Manually save an access token`, `• /zed set-cookie  - Manually save a zed.session cookie`, `• /zed set-spend   - Set baseline monthly spend (e.g. /zed set-spend 1.90)`, `• /zed reset-usage - Reset local spend count to $0.00`].join("\n"), "info");
        },
    });
}
//# sourceMappingURL=zed-command.js.map