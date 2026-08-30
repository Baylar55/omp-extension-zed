/**
 * Client for dispatching completion requests to Zed Cloud / API backend.
 */
export class ZedCloudClient {
    baseUrl;
    constructor(baseUrl = "https://cloud.zed.dev/api") {
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }
    /**
     * Builds request headers with appropriate auth credentials.
     */
    buildHeaders(creds) {
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": "Zed",
            "Accept": "application/json, text/event-stream",
        };
        if (creds.accessToken) {
            headers["Authorization"] = `Bearer ${creds.accessToken}`;
        }
        if (creds.sessionCookie) {
            headers["Cookie"] = creds.sessionCookie.startsWith("zed.session=")
                ? creds.sessionCookie
                : `zed.session=${creds.sessionCookie}`;
        }
        return headers;
    }
    /**
     * Sends a completion request to Zed and streams back text / events.
     */
    async *streamCompletion(req, creds, signal) {
        const url = `${this.baseUrl}/assistant/chat`;
        const headers = this.buildHeaders(creds);
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(req),
            signal,
        });
        if (!response.ok) {
            const errorText = await response.text().catch(() => "Unknown error");
            if (response.status === 401 || response.status === 403) {
                throw new Error(`Zed Authentication Failed (${response.status}): Please run /zed login. ${errorText}`);
            }
            if (response.status === 429) {
                throw new Error(`Zed Rate Limit or Quota Exceeded: ${errorText}`);
            }
            throw new Error(`Zed Cloud API error (${response.status}): ${errorText}`);
        }
        if (!response.body) {
            throw new Error("Empty response body received from Zed API.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith(":"))
                        continue;
                    if (trimmed.startsWith("data: ")) {
                        const dataStr = trimmed.slice(6);
                        if (dataStr === "[DONE]") {
                            yield { done: true };
                            return;
                        }
                        try {
                            const parsed = JSON.parse(dataStr);
                            if (parsed.text) {
                                yield { text: parsed.text };
                            }
                            else if (parsed.choices?.[0]?.delta?.content) {
                                yield { text: parsed.choices[0].delta.content };
                            }
                            else if (parsed.reasoning || parsed.choices?.[0]?.delta?.reasoning_content) {
                                yield { reasoning: parsed.reasoning || parsed.choices[0].delta.reasoning_content };
                            }
                            else if (typeof parsed === "string") {
                                yield { text: parsed };
                            }
                        }
                        catch {
                            // Yield raw line if not strict JSON
                            yield { text: dataStr };
                        }
                    }
                    else {
                        // Non-SSE standard text stream
                        yield { text: trimmed };
                    }
                }
            }
            if (buffer.trim()) {
                yield { text: buffer.trim() };
            }
        }
        finally {
            reader.releaseLock();
        }
    }
    /**
     * Executes a non-streaming completion request.
     */
    async complete(req, creds, signal) {
        let fullText = "";
        let fullReasoning = "";
        for await (const event of this.streamCompletion({ ...req, stream: false }, creds, signal)) {
            if (event.text)
                fullText += event.text;
            if (event.reasoning)
                fullReasoning += event.reasoning;
        }
        return { content: fullText, reasoning: fullReasoning || undefined };
    }
}
//# sourceMappingURL=client.js.map