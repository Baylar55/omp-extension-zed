export function isPlausibleJwt(token) {
    const t = token.trim();
    return t.startsWith("eyJ") && t.split(".").length === 3 && t.length > 20;
}
export function isEncryptedPayload(token) {
    const t = token.trim();
    return t.length >= 300 && t.length <= 500 && !isPlausibleJwt(t) && !t.startsWith("{") && /^[A-Za-z0-9-_+/=]+$/.test(t);
}
export function decodeJwtExp(token) {
    try {
        const payload = token.split(".")[1];
        if (!payload)
            return null;
        const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
        if (typeof json.exp === "number")
            return json.exp * 1000;
    }
    catch { }
    return null;
}
export function normalizeToken(raw) {
    if (!raw)
        return "";
    return raw.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
}
//# sourceMappingURL=token.js.map