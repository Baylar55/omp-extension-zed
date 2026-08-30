import { loadCredentials, saveCredentials } from "./auth/credential-store.js";
import { startOAuthFlow } from "./auth/oauth.js";
import { startBridgeServer } from "./bridge/server.js";
import { registerZedCommands } from "./commands/zed-command.js";
import { ZED_MODELS } from "./models.js";
let activeBridge = null;
/**
 * Main Oh My Pi extension factory for Zed Pro & Student Integration.
 */
export default async function ompZedExtension(pi) {
    // 1. Start the in-process local bridge server
    if (!activeBridge) {
        activeBridge = await startBridgeServer();
    }
    // 2. Register Zed as a first-class OMP model provider
    pi.registerProvider("zed", {
        baseUrl: activeBridge.baseUrl,
        api: "openai-completions",
        authHeader: false,
        models: ZED_MODELS,
        oauth: {
            name: "Zed Pro / Student Plan",
            login: async (_callbacks) => {
                const creds = await startOAuthFlow();
                saveCredentials(creds);
                return creds.accessToken || creds.sessionCookie || "authenticated";
            },
        },
    });
    // 3. Register Slash Commands (/zed)
    registerZedCommands(pi);
    // 4. Session Start notification
    pi.on("session_start", async (_event, ctx) => {
        const creds = loadCredentials();
        if (creds && (creds.accessToken || creds.sessionCookie)) {
            ctx.ui.notify("Zed Pro extension active. Models ready: zed/claude-sonnet-4-6, zed/gpt-5.4, zed/gemini-3.5-flash", "info");
        }
        else {
            ctx.ui.notify("Zed Pro extension loaded. Run '/zed login' to connect your Zed student/pro plan.", "info");
        }
    });
    // 5. Cleanup bridge on session shutdown
    pi.on("session_shutdown", async () => {
        if (activeBridge) {
            await activeBridge.stop();
            activeBridge = null;
        }
    });
}
//# sourceMappingURL=index.js.map