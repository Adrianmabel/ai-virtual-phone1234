import { loadChatSessions } from "./chat-storage";
import { bridgeRequest, type BridgeJob } from "./astrbot-client";
import type { ApiConfig } from "./settings-types";
import type { LLMMessage } from "./llm-prompt-assembler";

const prefix = "wenwen-readonly:";
const receiptKey = "wenwen-feature-receipts-v1";
export type FeatureReceipt = { id: string; characterId: string; kind: string; createdAt: number };

export function getFeatureApi(characterId: string): ApiConfig | null {
    if (!loadChatSessions().some(s => !s.isGroup && s.contactId === characterId && s.backend === "astrbot")) return null;
    return { id: prefix + characterId, provider: "astrbot", apiKey: "", defaultModel: "existing-qq",
        enableNativeTools: false, enableImageRecognition: false, enableImageGeneration: false };
}

export function isFeatureApi(config: ApiConfig) { return config.id.startsWith(prefix); }
export function featureKind(appId?: string, tags?: string[]): string | null {
    if (appId?.startsWith("checkphone")) return "checkphone";
    if (appId === "diary") return tags?.some(t => t.startsWith("notewall")) ? "notewall" : "diary";
    return ["moments", "xiaohongshu", "calendar"].includes(appId || "") ? appId! : null;
}
export function loadFeatureReceipts(): FeatureReceipt[] {
    try { return JSON.parse(localStorage.getItem(receiptKey) || "[]"); } catch { return []; }
}

export async function generateFeature(config: ApiConfig, messages: LLMMessage[], appId?: string, tags?: string[], signal?: AbortSignal): Promise<string> {
    const kind = featureKind(appId, tags);
    const characterId = config.id.slice(prefix.length);
    if (!kind || !getFeatureApi(characterId)) throw new Error("此功能未接入文文，或原聊天窗口已解除绑定。");
    // Only the dedicated assembler can provide format rules. Never upload phone
    // presets, character cards, local memories or chat history to AstrBot.
    const rules = messages.find(m => m._debugMeta?.marker === "wenwen_feature_rules");
    if (!rules || typeof rules.content !== "string") throw new Error("功能格式规则缺失，请更新全部手机适配文件。");
    const tasks = messages.filter(m => m !== rules && m.role === "user").map(m => {
        if (typeof m.content === "string") return m.content;
        if (m.content.some(p => p.type !== "text")) throw new Error("本期文文功能只支持文字任务，请移除图片后再试。");
        return m.content.map(p => p.type === "text" ? p.text : "").join("\n");
    });
    const task = [rules.content, ...tasks].join("\n\n");
    if (task.length > 24000 || new TextEncoder().encode(task).byteLength > 36000) throw new Error("本次功能上下文过长，请缩小生成范围。");
    const pending: BridgeJob | null = await bridgeRequest("pending", undefined, signal);
    if (pending) throw new Error("有一项请求尚未确认，请到文文连接页查看；本次任务尚未提交。");
    const id = crypto.randomUUID();
    const receipts = [...loadFeatureReceipts(), { id, characterId, kind, createdAt: Date.now() }].slice(-30);
    // Save before POST. A lost response must never cause an automatic replay.
    localStorage.setItem(receiptKey, JSON.stringify(receipts));
    let job: BridgeJob = await bridgeRequest("features", { id, kind, task }, signal);
    const deadline = Date.now() + 200_000;
    while (job.status === "queued" || job.status === "running") {
        if (signal?.aborted || Date.now() > deadline) throw new Error("已停止手机等待，请在连接页查原任务；不要重新生成。");
        await new Promise(resolve => setTimeout(resolve, 1000));
        job = await bridgeRequest(`jobs/${id}`, undefined, signal);
    }
    if (job.status !== "completed") throw new Error("功能任务未完成，请到连接页查看状态；不要自动重试。");
    return job.parts.map(p => p.text).join("\n\n");
}
