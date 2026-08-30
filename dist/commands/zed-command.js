import { clearCredentials, findBrowserSessionCookie, loadCredentials, maskSecret, saveCredentials } from "../auth/credential-store.js";
import { openBrowser, startOAuthFlow } from "../auth/oauth.js";
import { ZED_MODELS } from "../models.js";
import { fetchZedUsage, formatUsageSummary, resetLocalSpendHistory, setLocalSpendAmount } from "../usage/tracker.js";
/**
 * Registers the `/zed` slash command and its subcommands.
 */
export function registerZedCommands(pi) {
    pi.registerCommand("zed", {
        description: "Manage Zed Pro / Student subscription models, authentication, and usage",
        handler: async (args, ctx) => {
            const subCommand = args.trim().toLowerCase().split(/\s+/)[0];
            switch (subCommand) {
                case "usage": {
                    ctx.ui.notify("Fetching live usage from Zed Cloud...", "info");
                    const creds = loadCredentials();
                    if (!creds || (!creds.accessToken && !creds.sessionCookie)) {
                        ctx.ui.notify("No Zed credentials found. Please run '/zed login' to connect your Zed account.", "warning");
                        return;
                    }
                    const report = await fetchZedUsage(creds);
                    if (report && report.username && !creds.githubUsername) {
                        saveCredentials({
                            ...creds,
                            githubUsername: report.username,
                            userId: report.userId || creds.userId,
                        });
                    }
                    const summary = formatUsageSummary(report);
                    ctx.ui.notify(summary, "info");
                    break;
                }
                case "status": {
                    const creds = loadCredentials();
                    if (!creds || (!creds.accessToken && !creds.sessionCookie)) {
                        ctx.ui.notify("Zed Status: Disconnected (No credentials stored). Run '/zed login'.", "warning");
                        return;
                    }
                    const tokenDisplay = maskSecret(creds.accessToken);
                    const cookieDisplay = maskSecret(creds.sessionCookie);
                    const user = creds.githubUsername || creds.userId || "Authenticated User";
                    const sourceDisplay = creds.source === "system_keychain"
                        ? "System Keychain / Credential Manager (Auto-detected)"
                        : creds.source === "env"
                            ? "Environment Variable"
                            : "Saved Auth File";
                    const statusMsg = [
                        `🔌 Zed Pro Status: Connected`,
                        `User:          ${user}`,
                        `Source:        ${sourceDisplay}`,
                        `Access Token:  ${tokenDisplay}`,
                        `Session Cookie:${cookieDisplay}`,
                        `Saved At:      ${creds.savedAt ? new Date(creds.savedAt).toLocaleString() : "Unknown"}`,
                    ].join("\n");
                    ctx.ui.notify(statusMsg, "info");
                    break;
                }
                case "models": {
                    const modelList = ZED_MODELS.map((m) => `• zed/${m.id} (${m.name}) - Context: ${(m.contextWindow / 1000).toFixed(0)}k tokens`).join("\n");
                    ctx.ui.notify(`📋 Available Zed Models:\n${modelList}`, "info");
                    break;
                }
                case "login": {
                    ctx.ui.notify("Starting Zed authentication in browser...", "info");
                    try {
                        const creds = await startOAuthFlow();
                        ctx.ui.notify(`✓ Successfully logged in as ${creds.githubUsername || "Zed User"}!`, "info");
                    }
                    catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        ctx.ui.notify(`Authentication failed: ${msg}`, "error");
                    }
                    break;
                }
                case "logout": {
                    const removed = clearCredentials();
                    if (removed) {
                        ctx.ui.notify("✓ Successfully logged out from Zed. Credentials removed.", "info");
                    }
                    else {
                        ctx.ui.notify("No active Zed credentials found to remove.", "info");
                    }
                    break;
                }
                case "set-token": {
                    const token = args.replace(/^set-token\s+/i, "").trim();
                    if (!token) {
                        ctx.ui.notify("Usage: /zed set-token <your_token>", "warning");
                        return;
                    }
                    saveCredentials({ accessToken: token });
                    ctx.ui.notify("✓ Token saved successfully!", "info");
                    break;
                }
                case "set-cookie": {
                    const cookie = args.replace(/^set-cookie\s+/i, "").trim();
                    if (!cookie) {
                        ctx.ui.notify("Usage: /zed set-cookie <your_session_cookie>", "warning");
                        return;
                    }
                    saveCredentials({ sessionCookie: cookie });
                    ctx.ui.notify("✓ Session cookie saved successfully! Live dashboard sync enabled.", "info");
                    break;
                }
                case "set-spend": {
                    const amountStr = args.replace(/^set-spend\s+/i, "").replace(/^\$/, "").trim();
                    const amount = parseFloat(amountStr);
                    if (isNaN(amount) || amount < 0) {
                        ctx.ui.notify("Usage: /zed set-spend <amount_in_usd> (e.g. /zed set-spend 0.53)", "warning");
                        return;
                    }
                    setLocalSpendAmount(amount);
                    ctx.ui.notify(`✓ Current spend set to $${amount.toFixed(2)}.`, "info");
                    break;
                }
                case "sync": {
                    ctx.ui.notify("Scanning local browsers for active dashboard.zed.dev session...", "info");
                    const creds = loadCredentials();
                    const discoveredCookie = findBrowserSessionCookie();
                    if (discoveredCookie) {
                        const report = await fetchZedUsage({ ...creds, sessionCookie: discoveredCookie });
                        if (report && report.hasDetailedBilling) {
                            saveCredentials({ sessionCookie: discoveredCookie });
                            ctx.ui.notify("✓ Successfully synced live billing from browser session!", "info");
                            const summary = formatUsageSummary(report);
                            ctx.ui.notify(summary, "info");
                            break;
                        }
                    }
                    // If no working cookie found in browser DBs, open dashboard in browser
                    openBrowser("https://dashboard.zed.dev");
                    ctx.ui.notify([
                        "Opened https://dashboard.zed.dev in your browser.",
                        "1. Log in on dashboard.zed.dev if needed.",
                        "2. Run '/zed sync' to auto-import your live spend (no DevTools needed!).",
                    ].join("\n"), "info");
                    break;
                }
                case "reset-usage": {
                    resetLocalSpendHistory();
                    ctx.ui.notify("✓ Local usage spend count has been reset to $0.00.", "info");
                    break;
                }
                default: {
                    const help = [
                        `⚡ Zed Extension Commands:`,
                        `• /zed usage       - View monthly credit usage & quota meter`,
                        `• /zed sync        - Auto-sync live dollar spend from browser session`,
                        `• /zed status      - View authentication & connection status`,
                        `• /zed models      - List all accessible Zed models`,
                        `• /zed login       - Connect your Zed account via browser`,
                        `• /zed logout      - Remove stored Zed credentials`,
                        `• /zed set-token   - Manually save an access token`,
                        `• /zed set-cookie  - Manually save a zed.session cookie`,
                        `• /zed set-spend   - Set baseline monthly spend (e.g. /zed set-spend 1.90)`,
                        `• /zed reset-usage - Reset local spend count to $0.00`,
                    ].join("\n");
                    ctx.ui.notify(help, "info");
                    break;
                }
            }
        },
    });
}
//# sourceMappingURL=zed-command.js.map