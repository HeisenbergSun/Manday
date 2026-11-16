/**
 * 问卷式新手引导（P2-1）— 首次登录 3 问：团队规模 / 主要用途 / 想先看哪个模板
 * 按答案预置模板看板 + 示例数据，替代干巴巴的空看板
 * 完成后写 localStorage（按 userId 区分），只出现一次
 */
import { useState } from 'react';
import { api } from '../api';

const USE_CASES: { key: string; label: string; tpl: string; boardName: string }[] = [
  { key: 'project', label: '项目管理 / 任务跟踪', tpl: 'project', boardName: '我的第一个项目' },
  { key: 'product', label: '产品需求管理', tpl: 'backlog', boardName: '需求池' },
  { key: 'ops', label: '运营 / 市场活动', tpl: 'campaign', boardName: '市场活动' },
  { key: 'hiring', label: '招聘 / HR 流程', tpl: 'hiring', boardName: '招聘管线' },
];

export function OnboardingModal({ userId, onDone }: { userId: string; onDone: (boardId: string) => void }) {
  const [step, setStep] = useState(0);
  const [teamSize, setTeamSize] = useState('');
  const [pick, setPick] = useState<string>('project');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const finish = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    const uc = USE_CASES.find((u) => u.key === pick) ?? USE_CASES[0];
    try {
      const r: any = await api.instantiateTemplate(uc.tpl, uc.boardName, true);
      const boardId = r?.boardId ?? r?.id;
      if (!boardId) throw new Error('创建未返回 Board ID');
      localStorage.setItem('manday_onboarded_' + userId, '1');
      onDone(boardId);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const chip = (active: boolean) => ({
    padding: '10px 16px', borderRadius: 10, fontSize: 13.5, cursor: 'pointer',
    border: active ? '2px solid #4f6ef7' : '1px solid #e6e8ef',
    background: active ? '#eef1fe' : '#fff', color: active ? '#4f6ef7' : '#444452', fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,70,.45)', zIndex: 200,
      display: 'flex', alignItems: 'center', justifyContent: 'center' }} data-onboarding="1">
      <div style={{ width: 520, background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ fontSize: 11, color: '#a0a4b1', marginBottom: 6 }}>第 {step + 1} / 3 步</div>
        {step === 0 && (
          <>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>👋 欢迎来到 Manday</div>
            <div style={{ fontSize: 13, color: '#7a7f8c', marginBottom: 18 }}>3 个问题帮你搭好第一个看板（约 30 秒）</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>你们团队大概多少人？</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['1-10 人', '11-50 人', '51-200 人'].map((s) => (
                <span key={s} style={chip(teamSize === s)} onClick={() => { setTeamSize(s); setStep(1); }}>{s}</span>
              ))}
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>团队规模：{teamSize}。你们主要用它做什么？</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {USE_CASES.map((u) => (
                <span key={u.key} style={chip(pick === u.key)} onClick={() => setPick(u.key)}>{u.label}</span>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
              <button onClick={() => setStep(0)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e6e8ef',
                background: 'none', cursor: 'pointer', fontSize: 13 }}>上一步</button>
              <button onClick={() => setStep(2)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none',
                background: '#4f6ef7', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>下一步</button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>为你选好了模板</div>
            <div style={{ background: '#f6f7fb', borderRadius: 10, padding: 14, margin: '10px 0 16px', fontSize: 13, lineHeight: 1.8 }}>
              📋 <b>{USE_CASES.find((u) => u.key === pick)?.boardName}</b>（{USE_CASES.find((u) => u.key === pick)?.label}）<br />
              <span style={{ color: '#7a7f8c' }}>内置列结构 + 分组 + 5 条示例条目——进来看一眼就懂怎么用</span>
            </div>
            {err && <div style={{ background: '#fff1f0', color: '#e2445c', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button onClick={() => setStep(1)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e6e8ef',
                background: 'none', cursor: 'pointer', fontSize: 13 }}>上一步</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={finish} data-onboarding-skip disabled={busy}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e6e8ef', background: '#fff',
                    cursor: 'pointer', fontSize: 13 }}>跳过，稍后再说</button>
                <button onClick={finish} disabled={busy} data-onboarding-create
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none',
                    background: busy ? '#a9b6fb' : '#4f6ef7', color: '#fff', cursor: busy ? 'wait' : 'pointer',
                    fontSize: 13, fontWeight: 500 }}>{busy ? '创建中…' : '创建并开始'}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
