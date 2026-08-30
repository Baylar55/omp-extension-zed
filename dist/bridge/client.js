import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ZED_ENDPOINT, ZED_VERSION } from "./types.js";
function debugLog(msg) {
    if (process.env["DEBUG_ZED"] !== "1" && process.env["DEBUG_ZED"] !== "true") {
        return;
    }
    try {
        const logPath = path.join(os.homedir(), ".omp", "agent", "zed_debug.log");
        fs.mkdirSync(path.dirname(logPath), { recursive: true, mode: 0o700 });
        fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`, {
            mode: 0o600,
        });
    }
    catch { }
}
function normalizeToken(raw) {
    if (!raw)
        return "";
    return raw.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
}
function isJwt(token) {
    return token.trim().startsWith("eyJ") && token.trim().split(".").length === 3;
}
function isEncryptedPayload(token) {
    const t = token.trim();
    return t.length >= 300 && t.length <= 500 && !isJwt(t) && !t.startsWith("{") && /^[A-Za-z0-9-_+/=]+$/.test(t);
}
function decodeJwtExp(token) {
    try {
        const payload = token.split(".")[1];
        if (!payload)
            return null;
        // Pad base64url
        let b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64.length % 4;
        if (pad)
            b64 += "=".repeat(4 - pad);
        const json = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
        if (typeof json.exp === "number")
            return json.exp * 1000;
    }
    catch { }
    return null;
}
/**
 * Client for dispatching completion requests to Zed Cloud / API backend.
 * Verified against live endpoint 2026-08-12: POST https://cloud.zed.dev/completions
 */
export class ZedCloudClient {
    baseUrl;
    version;
    cachedJwt = null;
    cachedJwtExp = 0;
    constructor(baseUrl = ZED_ENDPOINT, version = ZED_VERSION) {
        this.baseUrl = baseUrl.replace(/\/$/, "");
        this.version = version;
    }
    async resolveJwt(creds) {
        const rawAccess = creds.accessToken?.trim() || "";
        if (isEncryptedPayload(rawAccess)) {
            throw new Error("Invalid Zed token: appears to be an encrypted value that was not decrypted. This is a bug from a previous login. Please run /zed logout then /zed login again (with the updated extension).");
        }
        const normalized = normalizeToken(rawAccess);
        // 1. If it's already a JWT, use it if not expired
        if (isJwt(normalized)) {
            const exp = decodeJwtExp(normalized);
            // If we have expiry and it's still valid for >5min, use it
            if (exp && Date.now() + 5 * 60 * 1000 < exp) {
                return normalized;
            }
            // If no expiry or expiring soon, still try to use it – server will tell us if 401
            // But if we also have a cached fresh JWT, prefer it
            if (this.cachedJwt && Date.now() + 5 * 60 * 1000 < this.cachedJwtExp) {
                return this.cachedJwt;
            }
            // If JWT is present but we have userId + secret that could refresh, try refresh
            // Fall through to exchange attempt if we have userId
            if (!creds.userId) {
                return normalized;
            }
        }
        // 2. Return cached JWT if still valid
        if (this.cachedJwt && Date.now() + 5 * 60 * 1000 < this.cachedJwtExp) {
            return this.cachedJwt;
        }
        // 3. Try to exchange access token (secret JSON) for JWT
        const userId = creds.userId?.trim();
        // The secret JSON is the raw accessToken value when it's not a JWT
        // It typically starts with { and contains version field
        const secretJson = rawAccess;
        if (userId && secretJson && secretJson.trim().startsWith("{")) {
            try {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 15000);
                const resp = await fetch("https://cloud.zed.dev/client/llm_tokens", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `${userId} ${secretJson}`,
                    },
                    body: "{}",
                    signal: controller.signal,
                }).finally(() => clearTimeout(timeout));
                if (resp.ok) {
                    const data = (await resp.json());
                    if (data.token) {
                        const jwt = normalizeToken(data.token);
                        const exp = decodeJwtExp(jwt);
                        this.cachedJwt = jwt;
                        this.cachedJwtExp = exp || Date.now() + 55 * 60 * 1000;
                        return jwt;
                    }
                }
                else {
                    const text = await resp.text().catch(() => "");
                    // If exchange fails, fall through to try raw token as Bearer
                    // but provide clear error if raw token is not JWT
                    if (!isJwt(normalized)) {
                        throw new Error(`JWT exchange failed (${resp.status}): ${text}`);
                    }
                }
            }
            catch (e) {
                if (!isJwt(normalized)) {
                    throw new Error(`Failed to exchange Zed access token for JWT. Please run /zed login again. ${e instanceof Error ? e.message : String(e)}`);
                }
                // If raw token is JWT, ignore exchange failure and use it
            }
        }
        // 4. Fallback: use normalized token if it looks like JWT or non-empty
        if (normalized) {
            // If it's not a JWT but we have no userId to exchange, we still try – server will give clear 401
            return normalized;
        }
        throw new Error("No valid Zed JWT available. Please run /zed login.");
    }
    /**
     * Builds request headers with appropriate auth credentials.
     * Zed expects Bearer JWT plus Zed version headers.
     */
    buildHeadersWithJwt(jwt, sessionCookie) {
        const headers = {
            "Content-Type": "application/json",
            "Accept": "*/*",
            "User-Agent": `Zed/${this.version} (windows; x86_64)`,
            "X-Zed-Version": this.version,
            "X-Zed-Client-Supports-Status-Messages": "true",
            "X-Zed-Client-Supports-Stream-Ended-Request-Completion-Status": "true",
        };
        if (jwt) {
            headers["Authorization"] = `Bearer ${jwt}`;
        }
        if (sessionCookie) {
            headers["Cookie"] = sessionCookie.startsWith("zed.session=")
                ? sessionCookie
                : `zed.session=${sessionCookie}`;
        }
        return headers;
    }
    /**
     * Sends a completion request to Zed and streams back text / events.
     * Zed streams NDJSON (newline-delimited JSON) with event types:
     * - message_start
     * - content_block_start (tool_use)
     * - content_block_delta (text, partial_json, thinking)
     * - content_block_stop
     * - message_delta / message_stop
     * - status: stream_ended
     */
    async *streamCompletion(req, creds, signal) {
        const url = this.baseUrl; // already is https://cloud.zed.dev/completions
        debugLog(`>>> ZED REQUEST provider=${req.provider} model=${req.model} temp=${req.temperature}`);
        let jwt;
        try {
            jwt = await this.resolveJwt(creds);
            debugLog(`>>> JWT ok len=${jwt.length} prefix=${jwt.slice(0, 10)}...`);
        }
        catch (e) {
            debugLog(`!!! resolveJwt failed: ${e instanceof Error ? e.message : String(e)}`);
            throw new Error(e instanceof Error ? e.message : String(e));
        }
        const headers = this.buildHeadersWithJwt(jwt, creds.sessionCookie);
        // The token is required; fail fast with clear message
        if (!headers["Authorization"]) {
            throw new Error("Zed Authentication Failed: No access token found. Please run /zed login.");
        }
        const sanitizedHeaders = {
            ...headers,
            Authorization: headers["Authorization"] ? headers["Authorization"].slice(0, 15) + "..." : undefined,
            Cookie: headers["Cookie"] ? "zed.session=••••••••" : undefined,
        };
        debugLog(`>>> FETCH ${url} headers=${JSON.stringify(sanitizedHeaders)}`);
        const effectiveSignal = signal || AbortSignal.timeout(60000);
        let response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(req),
            signal: effectiveSignal,
        });
        debugLog(`<<< FETCH status=${response.status} ok=${response.ok}`);
        // Retry once on 401 if we can refresh JWT (cached or exchangeable)
        if (!response.ok && response.status === 401) {
            const wasJwt = isJwt(jwt);
            const canRefresh = Boolean(this.cachedJwt || (creds.userId && creds.accessToken?.trim().startsWith("{")));
            if (canRefresh) {
                // Invalidate cache and try to get fresh JWT
                this.cachedJwt = null;
                this.cachedJwtExp = 0;
                try {
                    const freshJwt = await this.resolveJwt(creds);
                    if (freshJwt && freshJwt !== jwt) {
                        const retryHeaders = this.buildHeadersWithJwt(freshJwt, creds.sessionCookie);
                        const retrySignal = signal || AbortSignal.timeout(60000);
                        const retryResp = await fetch(url, {
                            method: "POST",
                            headers: retryHeaders,
                            body: JSON.stringify(req),
                            signal: retrySignal,
                        });
                        // Use retry response for further handling (whether ok or not)
                        response = retryResp;
                        jwt = freshJwt;
                    }
                }
                catch {
                    // ignore refresh failure, proceed to error handling with original response
                }
            }
            // If still 401 after retry, fall through to throw
            void wasJwt;
        }
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            debugLog(`!!! FETCH not ok: ${response.status} body=${errorText.slice(0, 1000)}`);
            let detail = errorText;
            try {
                const parsed = JSON.parse(errorText);
                detail = parsed.message || parsed.error?.message || errorText;
            }
            catch {
                // keep raw text
            }
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Zed Authentication Failed (${response.status}): Please run /zed login. ${detail}`);
            }
            if (response.status === 429) {
                throw new Error(`Zed Rate Limit or Quota Exceeded: ${detail}`);
            }
            if (response.status === 451) {
                throw new Error(`Zed Geo-Blocked (451): Access not available from this data center. ${detail}`);
            }
            throw new Error(`Zed Cloud API error (${response.status}): ${detail}`);
        }
        if (!response.body) {
            throw new Error("Empty response body received from Zed API.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let currentToolCall = null;
        let eventCount = 0;
        let textChars = 0;
        let reasoningChars = 0;
        debugLog(`>>> STREAM start`);
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    debugLog(`<<< STREAM done eventCount=${eventCount} textChars=${textChars} reasoningChars=${reasoningChars} bufferRemain=${buffer.length}`);
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line)
                        continue;
                    // Skip SSE keepalives if any
                    if (line.startsWith(":"))
                        continue;
                    // Zed may occasionally send SSE-style data: prefix, but primary is NDJSON.
                    // Handle both.
                    let jsonStr = line;
                    if (line.startsWith("data: ")) {
                        jsonStr = line.slice(6).trim();
                        if (jsonStr === "[DONE]") {
                            if (currentToolCall) {
                                yield { toolCall: { ...currentToolCall } };
                                currentToolCall = null;
                            }
                            yield { done: true };
                            return;
                        }
                    }
                    let json;
                    try {
                        json = JSON.parse(jsonStr);
                        // Log first few events for debug (avoid spam)
                        if (eventCount < 5)
                            debugLog(`<<< EVENT line=${jsonStr.slice(0, 500)}`);
                    }
                    catch {
                        // Not JSON, treat as raw text (fallback for non-NDJSON)
                        debugLog(`<<< NON_JSON line=${jsonStr.slice(0, 500)}`);
                        if (jsonStr)
                            yield { text: jsonStr };
                        continue;
                    }
                    // 1. Handle status sentinel
                    if (json && typeof json === "object" && "status" in json) {
                        const statusVal = json.status;
                        if (statusVal === "stream_ended") {
                            if (currentToolCall) {
                                yield { toolCall: { ...currentToolCall } };
                                currentToolCall = null;
                            }
                            yield { done: true };
                            return;
                        }
                        if (statusVal && typeof statusVal === "object" && "failed" in statusVal) {
                            const failedObj = statusVal.failed;
                            const failMsg = failedObj?.message || JSON.stringify(failedObj);
                            yield { error: failMsg };
                            return;
                        }
                    }
                    // 2. Check for Google Gemini format (candidates array)
                    const googleCandidates = (json && typeof json === "object" && "candidates" in json ? json.candidates : undefined) ||
                        (json && typeof json === "object" && "event" in json && json.event && typeof json.event === "object" && "candidates" in json.event ? json.event.candidates : undefined);
                    if (Array.isArray(googleCandidates)) {
                        eventCount++;
                        for (const cand of googleCandidates) {
                            if (!cand || typeof cand !== "object")
                                continue;
                            const content = "content" in cand && cand.content && typeof cand.content === "object" ? cand.content : undefined;
                            const parts = content && "parts" in content && Array.isArray(content.parts) ? content.parts : [];
                            for (const part of parts) {
                                if (!part || typeof part !== "object")
                                    continue;
                                if ("functionCall" in part && part.functionCall && typeof part.functionCall === "object") {
                                    const fc = part.functionCall;
                                    const argsStr = typeof fc.args === "string" ? fc.args : JSON.stringify(fc.args || {});
                                    yield {
                                        toolCall: {
                                            id: crypto.randomUUID(),
                                            name: fc.name || "unknown",
                                            arguments: argsStr,
                                            index: 0,
                                        },
                                    };
                                }
                                else if ("text" in part && typeof part.text === "string" && part.text.length > 0) {
                                    if ("thought" in part && Boolean(part.thought)) {
                                        reasoningChars += part.text.length;
                                        yield { reasoning: part.text };
                                    }
                                    else {
                                        textChars += part.text.length;
                                        yield { text: part.text };
                                    }
                                }
                            }
                            if ("finishReason" in cand && cand.finishReason) {
                                yield { done: true };
                            }
                        }
                        continue;
                    }
                    // 3. Extract event object (standard Zed envelope wraps in .event)
                    const event = json && typeof json === "object" && "event" in json && json.event && typeof json.event === "object"
                        ? json.event
                        : json;
                    if (!event || typeof event.type !== "string") {
                        // Check for error payloads
                        if (json && typeof json === "object" && ("error" in json || "message" in json)) {
                            const errObj = "error" in json ? json.error : undefined;
                            const errMsg = (errObj && typeof errObj === "object" && "message" in errObj ? errObj.message : undefined) ||
                                ("message" in json ? json.message : undefined) ||
                                JSON.stringify(json);
                            yield { error: String(errMsg) };
                        }
                        continue;
                    }
                    const type = event.type;
                    eventCount++;
                    // 4. OpenAI Responses API event handling (response.*)
                    if (type.startsWith("response.")) {
                        if (type === "response.created" || type === "response.in_progress") {
                            continue;
                        }
                        else if (type === "response.output_item.added") {
                            const item = "item" in event && event.item && typeof event.item === "object" ? event.item : undefined;
                            if (item && item.type === "function_call") {
                                if (currentToolCall) {
                                    yield { toolCall: { ...currentToolCall } };
                                }
                                currentToolCall = {
                                    index: typeof event.output_index === "number" ? event.output_index : 0,
                                    id: typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : crypto.randomUUID(),
                                    name: typeof item.name === "string" ? item.name : "unknown",
                                    arguments: typeof item.arguments === "string" ? item.arguments : "",
                                };
                            }
                        }
                        else if (type === "response.output_text.delta") {
                            const delta = "delta" in event && typeof event.delta === "string" ? event.delta : "";
                            if (delta) {
                                textChars += delta.length;
                                yield { text: delta };
                            }
                        }
                        else if (type === "response.function_call_arguments.delta") {
                            const delta = "delta" in event && typeof event.delta === "string" ? event.delta : "";
                            if (currentToolCall && delta) {
                                currentToolCall.arguments += delta;
                            }
                        }
                        else if (type === "response.function_call_arguments.done") {
                            const args = "arguments" in event && typeof event.arguments === "string" ? event.arguments : "";
                            if (currentToolCall && args) {
                                currentToolCall.arguments = args;
                            }
                        }
                        else if (type === "response.reasoning_text.delta" || type === "response.reasoning.delta" || type === "response.thought.delta") {
                            const delta = ("delta" in event && typeof event.delta === "string" ? event.delta : "") ||
                                ("text" in event && typeof event.text === "string" ? event.text : "");
                            if (delta) {
                                reasoningChars += delta.length;
                                yield { reasoning: delta };
                            }
                        }
                        else if (type === "response.output_item.done") {
                            if (currentToolCall) {
                                yield { toolCall: { ...currentToolCall } };
                                currentToolCall = null;
                            }
                        }
                        else if (type === "response.completed" || type === "response.done") {
                            if (currentToolCall) {
                                yield { toolCall: { ...currentToolCall } };
                                currentToolCall = null;
                            }
                            yield { done: true };
                        }
                        continue;
                    }
                    // 5. Anthropic Messages API event handling
                    if (type === "message_start") {
                        debugLog(`<<< message_start`);
                        continue;
                    }
                    else if (type === "content_block_start") {
                        const block = event.content_block;
                        if (block?.type === "tool_use") {
                            if (currentToolCall) {
                                yield { toolCall: { ...currentToolCall } };
                            }
                            currentToolCall = {
                                index: typeof event.index === "number" ? event.index : 0,
                                id: block.id || crypto.randomUUID(),
                                name: block.name || "unknown",
                                arguments: "",
                            };
                            const input = block.input;
                            if (input && typeof input === "object" && Object.keys(input).length > 0) {
                                currentToolCall.arguments += JSON.stringify(input);
                            }
                        }
                    }
                    else if (type === "content_block_delta") {
                        const delta = event.delta;
                        if (!delta)
                            continue;
                        if (typeof delta.text === "string" && delta.text.length > 0) {
                            textChars += delta.text.length;
                            yield { text: delta.text };
                        }
                        else if (typeof delta.partial_json === "string" && delta.partial_json.length > 0) {
                            if (currentToolCall)
                                currentToolCall.arguments += delta.partial_json;
                        }
                        else if (typeof delta.thinking === "string" && delta.thinking.length > 0) {
                            reasoningChars += delta.thinking.length;
                            yield { reasoning: delta.thinking };
                        }
                        else if (typeof delta.reasoning === "string" && delta.reasoning.length > 0) {
                            reasoningChars += delta.reasoning.length;
                            yield { reasoning: delta.reasoning };
                        }
                        else if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
                            reasoningChars += delta.reasoning_content.length;
                            yield { reasoning: delta.reasoning_content };
                        }
                    }
                    else if (type === "content_block_stop") {
                        if (currentToolCall) {
                            yield { toolCall: { ...currentToolCall } };
                            currentToolCall = null;
                        }
                    }
                    else if (type === "message_delta") {
                        // finish reason handling
                    }
                    else if (type === "message_stop") {
                        if (currentToolCall) {
                            yield { toolCall: { ...currentToolCall } };
                            currentToolCall = null;
                        }
                        yield { done: true };
                    }
                }
            }
            // Flush remaining buffer as last line (could be incomplete JSON)
            if (buffer.trim()) {
                const trimmed = buffer.trim();
                try {
                    const json = JSON.parse(trimmed);
                    const event = json.event;
                    if (event?.type === "content_block_delta" && event.delta?.text) {
                        yield { text: event.delta.text };
                    }
                }
                catch {
                    // If it's not JSON but has text, yield it
                    if (trimmed && !trimmed.startsWith("{")) {
                        yield { text: trimmed };
                    }
                }
            }
            if (currentToolCall) {
                yield { toolCall: { ...currentToolCall } };
            }
            yield { done: true };
        }
        finally {
            try {
                reader.releaseLock();
            }
            catch { }
        }
    }
    /**
     * Executes a non-streaming completion request.
     */
    async complete(req, creds, signal) {
        let fullText = "";
        let fullReasoning = "";
        for await (const event of this.streamCompletion(req, creds, signal)) {
            if (event.text)
                fullText += event.text;
            if (event.reasoning)
                fullReasoning += event.reasoning;
            if (event.done)
                break;
        }
        return { content: fullText, reasoning: fullReasoning || undefined };
    }
}
//# sourceMappingURL=client.js.map