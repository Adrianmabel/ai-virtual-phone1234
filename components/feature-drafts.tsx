"use client";

import { useState } from "react";
import { bridgeRequest, type BridgeJob } from "../lib/astrbot-client";
import { loadFeatureReceipts, type FeatureReceipt } from "../lib/astrbot-features";

type MemoryReceipt = { status: "writing" | "completed" | "unknown" | "failed" | "acknowledged"; memory_id?: string; error?: string };
const names: Record<string, string> = { moments: "朋友圈", xiaohongshu: "小红书", diary: "日记", notewall: "便签", calendar: "日历", checkphone: "查手机（模拟）" };

export function FeatureDrafts({ characterId }: { characterId: string }) {
    const [receipts, setReceipts] = useState<FeatureReceipt[]>([]);
    const [selected, setSelected] = useState("");
    const [draft, setDraft] = useState<BridgeJob | null>(null);
    const [text, setText] = useState("");
    const [memory, setMemory] = useState<MemoryReceipt | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState("先回手机手动生成，再到这里查看草稿。草稿不会自动成为记忆。");

    async function act(task: () => Promise<void>) {
        setBusy(true);
        try { await task(); } catch (error) { setNotice(error instanceof Error ? error.message : "无法读取状态，请勿重发。"); }
        finally { setBusy(false); }
    }
    async function inspect(id: string) {
        const job: BridgeJob = await bridgeRequest(`jobs/${id}`);
        if (!job.kind || job.kind === "chat") throw new Error("这是普通聊天消息，不属于功能草稿。");
        setDraft(job);
        setNotice(job.status === "completed" ? "草稿已生成，只在手机展示。若要记住，请自己整理下方内容。" : `草稿状态：${job.status}；不要重复生成。`);
    }

    return <section aria-label="手机功能草稿">
        <hr className="divider" />
        <h2>草稿，不是事实。</h2>
        <p className="foot">朋友圈、小红书、日记、便签、日历与查手机都在原页面使用。查手机是虚构内容，不读取真实设备；自动发帖、定时日记和图片生成不在本期接入范围。</p>
        <button className="secondary" disabled={busy} onClick={() => void act(async () => {
            const all = loadFeatureReceipts().filter(r => r.characterId === characterId).reverse();
            const pending: BridgeJob | null = await bridgeRequest("pending");
            if (pending?.kind && pending.kind !== "chat" && !all.some(r => r.id === pending.id)) {
                all.unshift({ id: pending.id, kind: pending.kind, characterId, createdAt: Date.now() });
            }
            setReceipts(all);
            if (all.length) { const id = selected || all[0].id; setSelected(id); await inspect(id); }
            else setNotice("这个角色还没有功能草稿；请先到手机原页面手动生成。");
        })}>读取草稿列表</button>
        <label htmlFor="feature-draft">最近的功能任务</label>
        <select id="feature-draft" value={selected} onChange={e => { setSelected(e.target.value); setDraft(null); setMemory(null); setText(""); }}>
            <option value="">选择任务</option>
            {receipts.map(r => <option key={r.id} value={r.id}>{names[r.kind] || r.kind} · {new Date(r.createdAt).toLocaleString()}</option>)}
        </select>
        <button className="secondary" disabled={!selected || busy} onClick={() => void act(() => inspect(selected))}>查看原任务，不重发</button>
        {draft && <>
            <p className="foot">{names[draft.kind || ""]} / {draft.status}{draft.error ? ` / ${draft.error}` : ""}</p>
            <details><summary>展开原始草稿（不会补进聊天）</summary>{draft.parts.map(p => <p key={p.id} className="preview">{p.text}</p>)}</details>
            {draft.status === "unknown" && <button className="secondary" disabled={busy} onClick={() => void act(async () => {
                if (!window.confirm("此草稿结果无法确认。解除状态不会重发，也不会写入记忆，是否已核对？")) return;
                await bridgeRequest(`jobs/${draft.id}/ack`, {}); await inspect(draft.id);
            })}>核对后解除草稿不确定状态</button>}
            <label htmlFor="memory-review">我确认要记住的内容 · 自己整理，不自动复制虚构草稿</label>
            <textarea id="memory-review" maxLength={1500} rows={5} value={text} disabled={busy || !!memory}
                onChange={e => setText(e.target.value)} style={{ width: "100%", background: "#faf8f0", color: "#27382f", border: "1px solid #b9bdac", padding: 14, font: "inherit" }} />
            <p className="foot">请分清真实事实和虚构设定。确认后，这段文字会进入同一 UMO 的 LivingMemory；不会额外新增一轮 QQ 聊天。每项草稿仅提交一次，失败或超时先检查记忆库。</p>
            <button disabled={draft.status !== "completed" || !text.trim() || busy || !!memory} onClick={() => void act(async () => {
                if (!window.confirm(`确认将以下内容加入文文的长期记忆？\n\n${text}\n\n虚构草稿不会自动变成真实事实，请确认文字准确。`)) return;
                setMemory(await bridgeRequest(`features/${draft.id}/remember`, { text, confirmed: true }));
                setNotice("记忆请求已提交，请查看写入状态；不要再次提交。");
            })}>审阅并确认记住</button>
            <button className="secondary" disabled={busy} onClick={() => void act(async () => {
                const receipt: MemoryReceipt = await bridgeRequest(`features/${draft.id}/memory`); setMemory(receipt);
                setNotice(receipt.status === "completed" ? "已写入 LivingMemory。" : receipt.status === "unknown" ? "写入是否完成无法确认，请先检查 LivingMemory；系统不会自动重试。" : receipt.status === "writing" ? "记忆正在写入，请稍后查看。" : "本任务不会再写入；若目标已切换，请核对配置后创建新草稿。");
            })}>查看记忆写入状态</button>
            {memory && <p className="foot">记忆：{memory.status}{memory.memory_id ? ` · 编号 ${memory.memory_id}` : ""}</p>}
            {memory?.status === "unknown" && <button className="secondary" disabled={busy} onClick={() => void act(async () => {
                if (!window.confirm("请先在 LivingMemory 中核对是否已写入。这一步只解除不确定状态，不会重写本条记忆，确认已核对？")) return;
                setMemory(await bridgeRequest(`features/${draft.id}/memory/ack`, { confirmed: true }));
                setNotice("已解除不确定状态，本任务不会再次写入记忆。");
            })}>核对记忆库后解除状态</button>}
        </>}
        <p className="notice" role="status">{notice}</p>
    </section>;
}
