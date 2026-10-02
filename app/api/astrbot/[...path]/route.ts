import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cookieName = "__Host-wenwen";

async function handle(request: NextRequest) {
    const base = process.env.WENWEN_BRIDGE_URL;
    const token = process.env.WENWEN_BRIDGE_TOKEN;
    const secret = process.env.WENWEN_COOKIE_SECRET;
    const origin = process.env.WENWEN_PHONE_ORIGIN;
    const fail = (error: string, status: number) => NextResponse.json({ error }, { status });
    if (!base || !token || token.length < 32 || !secret || secret.length < 32 || !origin) {
        return fail("bridge_not_configured", 503);
    }
    let bridgeUrl: URL;
    try { bridgeUrl = new URL(base); } catch { return fail("bridge_not_configured", 503); }
    if (bridgeUrl.protocol !== "https:" || bridgeUrl.username || bridgeUrl.password
        || bridgeUrl.search || bridgeUrl.hash || bridgeUrl.pathname !== "/") {
        return fail("bridge_not_configured", 503);
    }
    if (request.method === "POST" && request.headers.get("origin") !== origin) {
        return fail("forbidden_origin", 403);
    }
    const path = request.nextUrl.pathname.slice("/api/astrbot/".length);
    if (!(path === "login" || path === "jobs" || path === "features" || path === "pending" || /^jobs\/[a-zA-Z0-9_-]{8,100}(\/ack)?$/.test(path)
        || /^features\/[a-zA-Z0-9_-]{8,100}\/(remember|memory(\/ack)?)$/.test(path))) {
        return fail("not_found", 404);
    }
    if ((path === "login" || path === "jobs" || path === "features" || path.endsWith("/ack") || path.endsWith("/remember")) && request.method !== "POST") {
        return fail("method_not_allowed", 405);
    }
    if ((path === "pending" || path.endsWith("/memory") || /^jobs\/[a-zA-Z0-9_-]{8,100}$/.test(path)) && request.method !== "GET") {
        return fail("method_not_allowed", 405);
    }
    if (path !== "login") {
        const value = request.cookies.get(cookieName)?.value || "";
        const [expiry, signature, ...extra] = value.split(".");
        const expected = createHmac("sha256", secret).update(expiry || "").digest("hex");
        if (extra.length || !/^\d{10}$/.test(expiry || "") || !/^[a-f0-9]{64}$/.test(signature || "")
            || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
            || Number(expiry) <= Date.now() / 1000 || Number(expiry) > Date.now() / 1000 + 43200) {
            return fail("unauthorized", 401);
        }
    }
    let body: string | undefined;
    if (request.method === "POST") {
        const reader = request.body?.getReader();
        if (!reader) return fail("invalid_request", 400);
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 40000) { await reader.cancel(); return fail("request_too_large", 413); }
            chunks.push(value);
        }
        try {
            const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (path === "login") {
                // A single-user global bucket persists on the VPS and cannot be
                // bypassed with forged IP headers or new serverless workers.
                body = JSON.stringify({ password: input.password,
                    peer: createHmac("sha256", secret).update("single-user-login").digest("hex") });
            } else if (path === "jobs") body = JSON.stringify({ id: input.id, text: input.text });
            else if (path === "features") body = JSON.stringify({ id: input.id, kind: input.kind, task: input.task });
            else if (path.endsWith("/remember")) body = JSON.stringify({ text: input.text, confirmed: input.confirmed });
            else if (path.endsWith("/memory/ack")) body = JSON.stringify({ confirmed: input.confirmed });
            else body = "{}";
        } catch { return fail("invalid_request", 400); }
    }
    try {
        const upstream = await fetch(new URL(`/v1/${path}`, bridgeUrl), {
            method: request.method, headers: {
                Authorization: `Bearer ${token}`, "Content-Type": "application/json",
            }, body, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
        });
        const data = await upstream.json();
        const response = NextResponse.json(data, { status: upstream.status });
        response.headers.set("Cache-Control", "no-store, private");
        if (path === "login" && upstream.ok) {
            const expiry = Math.floor(Date.now() / 1000 + 43200).toString();
            const signature = createHmac("sha256", secret).update(expiry).digest("hex");
            response.cookies.set(cookieName, `${expiry}.${signature}`, {
                httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 43200,
            });
        }
        return response;
    } catch {
        return fail("bridge_unreachable_or_uncertain", 502);
    }
}

export const GET = handle;
export const POST = handle;
