import { loadChatMessages } from "./chat-storage";
import type { ChatSession, ChatMessage } from "./chat-storage";
import type { ChatCompletionCallbacks, ChatCompletionResult } from "./chat-engine";

export type BridgeJob = {
    id: string;
    status: "queued" | "running" | "completed" | "failed" | "unknown";
    parts: { id: string; text: string }[];
    error?: string;
};

export async function bridgeRequest(path: string, body?: unknown, signal?: AbortSignal) {
    const response = await fetch(`/api/astrbot/${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin", cache: "no-store", signal,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
        const hints: Record<string, string> = {
            unauthorized: "请先打开 /wenwen-connect 登录连接文文。",
            previous_request_unresolved: "上一条消息状态尚未确认，请到连接页查看，不要重发。",
            commands_not_supported: "手机入口暂不支持 AstrBot 命令，请使用 QQ。",
            too_many_attempts: "登录尝试过多，请十分钟后再试。",
            incorrect_password: "连接密码不正确。",
        };
        throw new Error(hints[data.error] || "连接失败；请到连接页检查，勿重复发送。");
    }
    return data;
}

export async function generateAstrBotReply(
    session: ChatSession, history: ChatMessage[], signal?: AbortSignal,
    callbacks?: ChatCompletionCallbacks,
): Promise<ChatCompletionResult> {
    if (session.isGroup) throw new Error("AstrBot 桥接只支持文文的私聊窗口。");
    const last = history.at(-1);
    if (!last || last.role !== "user" || (last.mediaType && last.mediaType !== "quote")) {
        throw new Error("请发送一条文字；此窗口不支持空回复、重生成或手机媒体工具。");
    }
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${session.id}:${last.id}`));
    const id = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
    const pending: BridgeJob | null = await bridgeRequest("pending", undefined, signal);
    if (pending && pending.id !== id) {
        localStorage.setItem(`wenwen-job:${session.id}`, pending.id);
        throw new Error("上一条消息尚未确认，请到连接页查看；这条新消息还没有交给 AstrBot。");
    }
    // Never send phone history, character cards, presets or model credentials.
    localStorage.setItem(`wenwen-job:${session.id}`, id);
    let job: BridgeJob = await bridgeRequest("jobs", { id, text: last.content }, signal);
    const deadline = Date.now() + 180_000;
    while (job.status === "queued" || job.status === "running") {
        if (signal?.aborted) throw new Error("已停止手机等待；服务器可能仍在回复，请到连接页查看。");
        if (Date.now() > deadline) throw new Error("文文还未完成回复，请到连接页查看；不要重发。");
        await new Promise(resolve => setTimeout(resolve, 1000));
        job = await bridgeRequest(`jobs/${id}`, undefined, signal);
    }
    if (job.status !== "completed") {
        throw new Error(job.status === "unknown"
            ? "这条消息是否完成无法确认，请到连接页核对 QQ 和回复，勿重发。"
            : `未完成文字回复（${job.error || "unknown"}），请到连接页查看。`);
    }
    for (const part of job.parts) {
        if (!loadChatMessages(session.id).some(m => m.responseBatchId === part.id)) {
            await callbacks?.onTextPart?.(part.text, undefined, {
                responseBatchId: part.id, rawResponseText: part.text,
            });
        }
    }
    return { parts: job.parts.map(part => ({ text: part.text })) };
}
