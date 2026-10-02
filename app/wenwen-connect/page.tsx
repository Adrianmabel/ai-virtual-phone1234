"use client";

import { useEffect, useState } from "react";
import { hydrateChatStorage, loadChatSessions, saveChatSessions, loadChatMessages, pushChatMessage } from "../../lib/chat-storage";
import type { ChatSession } from "../../lib/chat-storage";
import { bridgeRequest } from "../../lib/astrbot-client";
import type { BridgeJob } from "../../lib/astrbot-client";
import { cancelFollowUp, cancelBackgroundGeneration } from "../../lib/follow-up-service";

export default function WenwenConnect() {
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const [selected, setSelected] = useState("");
    const [password, setPassword] = useState("");
    const [notice, setNotice] = useState("正在读取手机已有的聊天窗口…");
    const [ready, setReady] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [job, setJob] = useState<BridgeJob | null>(null);

    useEffect(() => {
        void hydrateChatStorage().then(() => {
            const all = loadChatSessions().filter(s => !s.isGroup);
            setSessions(all);
            setSelected(all.find(s => s.backend === "astrbot")?.id || "");
            setNotice(all.length ? "请选择你已有的文文聊天窗口。" : "请先回手机添加文文联系人，再打开此页。");
        }).catch(() => setNotice("无法读取聊天记录，请回手机检查。"));
    }, []);

    async function act(task: () => Promise<void>) {
        setBusy(true);
        try { await task(); } catch (error) { setNotice(error instanceof Error ? error.message : "连接失败。"); }
        finally { setBusy(false); }
    }

    async function checkJob() {
        const pending: BridgeJob | null = await bridgeRequest("pending");
        if (pending) localStorage.setItem(`wenwen-job:${selected}`, pending.id);
        const id = localStorage.getItem(`wenwen-job:${selected}`);
        if (!id) { setNotice("这个窗口还没有手机桥接消息。"); return; }
        const result: BridgeJob = await bridgeRequest(`jobs/${id}`);
        setJob(result);
        setNotice({ queued: "消息已排队，请稍后再查。", running: "文文正在回复，请稍后再查。",
            completed: "回复已完成，可以补回原手机窗口。", failed: "本条未完成；详情见下方。",
            unknown: "状态不确定：可能已写入原会话，请先核对，勿重发。" }[result.status]);
    }

    return <main className="connect">
        <style>{`
            .connect{min-height:100dvh;background:#f3efe5;color:#27382f;padding:32px 22px 70px;font-family:'Noto Serif SC','Songti SC',serif}
            .connect *{box-sizing:border-box}.sheet{max-width:470px;margin:auto;border-top:5px solid #314b3c}
            .eyebrow{font:12px monospace;letter-spacing:.18em;margin:18px 0 46px;color:#697464}
            .connect h1{font-size:42px;line-height:1.15;font-weight:500;margin:0 0 18px}.intro{line-height:1.9;color:#647060;margin-bottom:34px}
            .connect label{display:block;margin:20px 0 9px;font-size:14px}.connect input:not([type=checkbox]),.connect select{width:100%;border:1px solid #b9bdac;border-radius:2px;padding:14px;background:#faf8f0;color:#27382f;font:16px inherit}
            .connect button{padding:14px 18px;min-height:46px;border:0;background:#314b3c;color:#fff;border-radius:2px;font:15px inherit;cursor:pointer;margin:12px 8px 0 0}
            .connect button.secondary{color:#314b3c;background:#e2e5d7}.connect button:disabled{opacity:.45;cursor:default}.connect a{color:#314b3c}
            .divider{margin:30px 0;border:0;border-top:1px solid #cbd0bc}.check{display:flex!important;gap:12px;line-height:1.7}.check input{margin-top:6px;accent-color:#314b3c}
            .notice{border-left:3px solid #9b7042;padding:12px 16px;background:#eae3d3;line-height:1.8;font-size:14px;margin:24px 0}.preview{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.foot{font-size:12px;color:#6d786b;line-height:1.9;margin-top:32px}
            @media(prefers-reduced-motion:no-preference){.sheet{animation:arrive .4s ease-out}@keyframes arrive{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}}
        `}</style>
        <section className="sheet">
            <p className="eyebrow">WENWEN / SAME CONVERSATION</p>
            <h1>换个入口，<br />还是文文。</h1>
            <p className="intro">手机与 QQ 共用原来的会话、记忆和世界书。<br />这里不创建新的 AstrBot 会话。</p>
            <form onSubmit={event => { event.preventDefault(); void act(async () => {
                await bridgeRequest("login", { password }); setPassword(""); setReady(true);
                setNotice("连接已验证。请选择原聊天窗口并确认绑定。");
            }); }}>
                <label htmlFor="password">连接密码 · 不是 QQ 密码</label>
                <input id="password" type="password" autoComplete="current-password" maxLength={256} value={password} onChange={e => setPassword(e.target.value)} required />
                <button disabled={busy}>验证连接</button>
            </form>
            <hr className="divider" />
            <label htmlFor="session">原来的文文聊天窗口</label>
            <select id="session" value={selected} onChange={e => { setSelected(e.target.value); setJob(null); }}>
                <option value="">请选择现有私聊</option>
                {sessions.map(s => <option key={s.id} value={s.id}>{s.alias || s.lastMessagePreview || s.contactId} · {s.id.slice(-6)}{s.backend === "astrbot" ? "（已绑定）" : ""}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                <span>我已停用该角色的手机微信联动、追问、冷场重连、定时唤醒和云端预约，并处理掉已排队的原生生成任务。</span>
            </label>
            <button disabled={!ready || !selected || !confirmed || busy} onClick={() => void act(async () => {
                cancelBackgroundGeneration(selected);
                const all = loadChatSessions();
                if (all.some(s => s.backend === "astrbot" && s.id !== selected)) throw new Error("已有一个绑定窗口。请先解除旧窗口，避免多个联系人都指向同一个文文。");
                const next = all.map(s => s.id === selected ? { ...s, backend: "astrbot" as const, streamOnline: false } : s);
                saveChatSessions(next); cancelFollowUp(selected); setSessions(next.filter(s => !s.isGroup));
                setNotice("已绑定。回到原聊天窗口发送文字，就会立即交给 AstrBot。");
            })}>绑定这个窗口</button>
            <button className="secondary" disabled={!selected || busy} onClick={() => {
                const all = loadChatSessions().map(s => s.id === selected ? { ...s, backend: "native" as const } : s);
                saveChatSessions(all); setSessions(all.filter(s => !s.isGroup));
                setNotice("已解除手机绑定；QQ 和 AstrBot 的原会话没有改动。服务器上已接受的消息不会被撤销。");
            }}>解除绑定</button>
            <div className="notice" role="status" aria-live="polite">{notice}</div>
            <button className="secondary" disabled={!selected || busy} onClick={() => void act(checkJob)}>查看上条消息</button>
            {job && <div>
                <p className="foot">状态：{job.status}{job.error ? ` / ${job.error}` : ""}</p>
                {job.parts.map(part => <p className="preview" key={part.id}>{part.text}</p>)}
                {job.parts.length > 0 && <button disabled={busy} onClick={() => {
                    for (const part of job.parts) if (!loadChatMessages(selected).some(m => m.responseBatchId === part.id)) {
                        pushChatMessage({ sessionId: selected, role: "assistant", content: part.text, responseBatchId: part.id, rawResponseText: part.text });
                    }
                    setNotice("已补回原窗口，重复的回复不会再次添加。");
                }}>补回已有文字回复</button>}
                {job.status === "unknown" && <button className="secondary" disabled={busy} onClick={() => void act(async () => {
                    if (!window.confirm("确认已核对原会话？此操作只解除不确定状态，不撤回原消息，也不会重发。")) return;
                    setJob(await bridgeRequest(`jobs/${job.id}/ack`, {}));
                    setNotice("已解除不确定状态。下一次请发送新消息；原消息没有重发。");
                })}>核对后解除不确定状态</button>}
            </div>}
            <p className="foot">第一期仅支持文字。手机的角色卡、提示词和旧聊天记录不会上传覆盖 AstrBot。中断等待不代表服务器停止；请查状态，不要连续重发。</p>
            <a href="/">回到手机</a>
        </section>
    </main>;
}
