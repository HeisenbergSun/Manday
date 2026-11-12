/**
 * AI 侧边栏 — 主入口（承载 80% AI 场景），对接 WorkBuddy 企业版 SSE 流
 * 交互铁律：AI 返回的写工具调用 → 渲染预览确认卡片 → 确认后走 /ai/tool/confirm
 */
import { useState, useRef } from 'react';
import { aiChatStream, api } from '../api';

interface Msg { role: 'user' | 'ai'; content: string; confirm?: { toolCallId: string; tool: string; summary: string; payload: unknown }; applied?: boolean; }

export function AiSidebar({ boardId }: { boardId?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  const scroll = () => requestAnimationFrame(() => boxRef.current?.scrollTo(0, 1e9));

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || busy) return;
    setInput(''); setBusy(true); setErr('');
    setMsgs((m) => [...m, { role: 'user', content: q }]); scroll();

    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = await aiChatStream(boardId, q);
    } catch (e) {
      setErr(`AI 请求失败：${(e as Error).message}`);
      setMsgs((m) => [...m, { role: 'ai', content: `⚠️ ${(e as Error).message}` }]);
      setBusy(false);
      return;
    }
    const decoder = new TextDecoder();
    let full = '';
    const idx = msgs.length + 1;
    setMsgs((m) => [...m, { role: 'ai', content: '' }]); scroll();

    // SSE 逐段渲染；特殊帧 [TOOL_CALL] {...} 转为确认卡片
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // 剥掉 SSE 帧前缀（后端发的是 `data: xxx\n\n`）
      const raw = decoder.decode(value, { stream: true });
      const chunk = raw
        .split('\n')
        .map((line) => (line.startsWith('data: ') ? line.slice(6) : line))
        .filter((line) => !line.startsWith('event:') && line !== '[DONE]')
        .join('');
      if (!chunk.trim()) continue;
      const toolMatch = chunk.match(/\[TOOL_CALL\] (.+)/);
      if (toolMatch) {
        const call = JSON.parse(toolMatch[1]);
        setMsgs((m) => {
          const next = [...m];
          next[next.length - 1] = {
            role: 'ai', content: full + '\n（写操作需要你确认）',
            confirm: { toolCallId: call.id, tool: call.tool, summary: call.summary, payload: call.payload },
          };
          return next;
        });
      } else { full += chunk; }
      setMsgs((m) => { const n = [...m]; n[n.length - 1] = { ...n[n.length - 1], content: full }; return n; });
      scroll();
    }
    setBusy(false);
  }

  /** 用户点"确认执行"——真正写入复用普通 API（ACL 再校验），AI 无独立写通道 */
  async function applyConfirm(mi: number) {
    const msg = msgs[mi];
    const res = await api.aiConfirmTool(msg.confirm!.toolCallId, msg.confirm!.tool, msg.confirm!.payload);
    setMsgs((m) => { const n = [...m]; n[mi] = { ...n[mi], applied: true, confirm: undefined }; return n; });
    // 成功后刷新 Board 数据（WS 也会推送增量）
  }

  return (
    <aside style={{
      width: 380, background: '#fff', borderLeft: '1px solid #e6e8ef', display: 'flex',
      flexDirection: 'column', flexShrink: 0,
    }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #e6e8ef', display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'linear-gradient(135deg,#4f6ef7,#9d3dd7)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✦</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>AI 助手 · WorkBuddy</div>
          <div style={{ fontSize: 11, color: '#7a7f8c' }}>已连接 Scania WorkBuddy 企业版</div>
        </div>
      </header>

      <div ref={boxRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{
            maxWidth: '88%', padding: '10px 13px', borderRadius: 12, fontSize: 13, whiteSpace: 'pre-wrap',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            background: m.role === 'user' ? '#4f6ef7' : '#f6f7fb', color: m.role === 'user' ? '#fff' : '#25272c',
            border: m.role === 'user' ? 'none' : '1px solid #e6e8ef',
          }}>
            {m.content}
            {m.confirm && !m.applied && (
              <div style={{ border: '1px solid #e6e8ef', borderRadius: 10, padding: 10, marginTop: 8, background: '#fff', fontSize: 12 }}>
                <b>✍️ 待确认：{m.confirm.tool}</b>
                <div style={{ color: '#7a7f8c', marginTop: 4 }}>{m.confirm.summary}</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                  <button onClick={() => setMsgs((n) => { const x = [...n]; x[i] = { ...x[i], applied: false, confirm: undefined }; return x; })}
                    style={{ padding: '4px 11px', borderRadius: 6, border: '1px solid #e6e8ef', background: 'none', cursor: 'pointer' }}>取消</button>
                  <button onClick={() => applyConfirm(i)}
                    style={{ padding: '4px 11px', borderRadius: 6, border: 'none', background: '#4f6ef7', color: '#fff', cursor: 'pointer' }}>确认执行</button>
                </div>
              </div>
            )}
            {m.applied && <div style={{ color: '#00c875', fontWeight: 600, fontSize: 12, marginTop: 6 }}>✓ 已执行（source: ai，可在审计日志追溯并撤销）</div>}
          </div>
        ))}
        {busy && <div style={{ alignSelf: 'flex-start', color: '#7a7f8c', fontSize: 13 }}>AI 正在查询…</div>}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid #e6e8ef' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {['我这周的任务和风险？', '生成本周进展周报'].map((s) => (
            <button key={s} onClick={() => send(s)}
              style={{ fontSize: 12, color: '#4f6ef7', background: '#eef1fe', border: 'none', borderRadius: 14, padding: '5px 11px', cursor: 'pointer' }}>{s}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="问我任何关于这个 Board 的问题…（Enter 发送，Shift+Enter 换行）"
            style={{ flex: 1, height: 64, border: '1px solid #e6e8ef', borderRadius: 10, padding: '9px 12px',
              fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
          <button onClick={() => send()} disabled={busy || !input.trim()}
            title="发送"
            style={{
              height: 40, padding: '0 16px', borderRadius: 10, border: 'none',
              background: busy || !input.trim() ? '#c9d3fb' : '#4f6ef7', color: '#fff',
              cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600, flexShrink: 0,
            }}>{busy ? '…' : '发送'}</button>
        </div>
        {err && <div style={{ marginTop: 8, color: '#e2445c', fontSize: 12 }}>{err}</div>}
      </div>
    </aside>
  );
}
