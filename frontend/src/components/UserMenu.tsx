/**
 * 右上角人员菜单：头像按钮 + 弹窗（个人档案 / 存档 / 回收站 / 功能设置 / 退出登录）
 * 以及「邀请人员」按钮（带 + 的人物图标）
 * 弹窗均点击外部自动关闭（复用铃铛的 mousedown 判定模式）
 */
import { useEffect, useRef, useState } from 'react';
import { api, clearToken } from '../api';
import { Icon } from './Icons';
import { useToast } from '../store';

/** 通用弹窗外层容器：定位 + 外部点击关闭 */
function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return ref;
}

/** 头像：有 avatar_url 用图片，否则姓名首字母圆形 */
function Avatar({ name, avatarUrl, size = 30 }: { name: string; avatarUrl?: string; size?: number }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#4f6ef7,#7b5cf0)',
      color: '#fff', fontSize: size * 0.44, fontWeight: 600, display: 'flex', alignItems: 'center',
      justifyContent: 'center', flexShrink: 0, userSelect: 'none' }}>
      {(name || 'M').slice(0, 1).toUpperCase()}
    </div>
  );
}

interface MeInfo { id: string; name: string; email: string; avatar_url?: string; department?: string; }

/** 弹窗内顶部返回条 */
function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px 6px', borderBottom: '1px solid #f0f1f5' }}>
      <button onClick={onBack} data-menu-back style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px 6px', fontSize: 14, color: '#7a7f8c', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon name="back" size={14} /> 返回
      </button>
      <b style={{ fontSize: 13, marginLeft: 8 }}>{title}</b>
    </div>
  );
}

/** 邀请人员：复制邀请链接 + 公司成员列表 */
export function InviteButton() {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const toast = useToast((s) => s.toast);
  const ref = useDismiss(() => setOpen(false));

  useEffect(() => {
    if (!open) return;
    api.listUsers().then((u) => setUsers(Array.isArray(u) ? u : [])).catch(() => {});
  }, [open]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/');
      toast('邀请链接已复制到剪贴板', 'success');
    } catch {
      toast('复制失败，请手动复制地址栏链接', 'error');
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button data-invite-btn onClick={() => setOpen(!open)} title="邀请人员"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'inline-flex', alignItems: 'center' }}>
        <Icon name="userPlus" size={19} color="#5a6072" />
      </button>
      {open && (
        <div data-invite-popover style={{ position: 'absolute', right: 0, top: 34, width: 320, background: '#fff',
          border: '1px solid #e6e8ef', borderRadius: 12, boxShadow: '0 8px 28px rgba(20,30,70,.15)', zIndex: 60 }}>
          <div style={{ padding: '12px 14px 6px', fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="userPlus" size={16} color="#4f6ef7" /> 邀请人员
          </div>
          <div style={{ padding: '0 14px 8px', fontSize: 12, color: '#7a7f8c', lineHeight: 1.6 }}>
            同事通过企业 SSO 登录后自动加入工作区。把链接分享给 TA 即可。
          </div>
          <div style={{ padding: '8px 14px' }}>
            <button onClick={copyLink} data-copy-invite style={{ width: '100%', padding: '8px 12px', borderRadius: 8,
              border: '1px solid #e6e8ef', background: '#f6f7fb', cursor: 'pointer', fontSize: 13, color: '#4f6ef7', fontWeight: 500 }}>
              复制邀请链接
            </button>
          </div>
          <div style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, color: '#a0a4b1' }}>工作区成员（{users.length}）</div>
          <div style={{ maxHeight: 200, overflowY: 'auto', paddingBottom: 8 }}>
            {users.length === 0 && <div style={{ padding: '12px 14px', color: '#a0a4b1', fontSize: 12 }}>暂无成员</div>}
            {users.map((u) => (
              <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px', fontSize: 13 }}>
                <Avatar name={u.name} size={26} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: '#a0a4b1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Panel = 'menu' | 'profile' | 'archive' | 'trash' | 'settings';

/** 人员头像菜单：个人档案 / 存档 / 回收站 / 功能设置 / 退出登录 */
export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>('menu');
  const [me, setMe] = useState<MeInfo | null>(null);
  const toast = useToast((s) => s.toast);
  const ref = useDismiss(() => { setOpen(false); setPanel('menu'); });

  useEffect(() => {
    if (!open) return;
    api.me().then((m) => setMe(m ?? null)).catch(() => {});
  }, [open]);

  // 存档
  const [archived, setArchived] = useState<any[]>([]);
  useEffect(() => { if (panel === 'archive') api.listArchivedBoards().then((a) => setArchived(Array.isArray(a) ? a : [])).catch(() => {}); }, [panel]);
  // 回收站
  const [trash, setTrash] = useState<any[]>([]);
  useEffect(() => { if (panel === 'trash') api.globalTrash().then((t) => setTrash(Array.isArray(t) ? t : [])).catch(() => {}); }, [panel]);

  const unarchive = async (b: any) => {
    try { await api.unarchiveBoard(b.id); setArchived((a) => a.filter((x) => x.id !== b.id)); toast(`已恢复「${b.name}」`, 'success'); }
    catch (e) { toast(`恢复失败：${(e as Error).message}`, 'error'); }
  };
  const restore = async (t: any) => {
    try { await api.restoreItems(t.board_id, [t.id]); setTrash((a) => a.filter((x) => x.id !== t.id)); toast(`已恢复「${t.name}」`, 'success'); }
    catch (e) { toast(`恢复失败：${(e as Error).message}`, 'error'); }
  };

  const menuItem = (key: Panel, icon: string, label: string) => (
    <button key={key} data-menu-item={key} onClick={() => setPanel(key)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', border: 'none',
        background: 'none', cursor: 'pointer', fontSize: 13, color: '#33333f', textAlign: 'left', borderRadius: 0 }}>
      <Icon name={icon} size={16} color="#5a6072" />
      {label}
    </button>
  );

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button data-user-menu-btn onClick={() => setOpen(!open)} title="个人菜单"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'inline-flex', alignItems: 'center' }}>
        <Avatar name={me?.name ?? ''} avatarUrl={me?.avatar_url} size={30} />
      </button>

      {open && (
        <div data-user-popover style={{ position: 'absolute', right: 0, top: 40, width: 300, background: '#fff',
          border: '1px solid #e6e8ef', borderRadius: 12, boxShadow: '0 8px 28px rgba(20,30,70,.15)', zIndex: 60, overflow: 'hidden' }}>
          {panel === 'menu' && (
            <>
              {/* 用户信息卡 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f0f1f5' }}>
                <Avatar name={me?.name ?? ''} avatarUrl={me?.avatar_url} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#25272c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.name ?? '…'}</div>
                  <div style={{ fontSize: 12, color: '#a0a4b1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.email ?? ''}</div>
                </div>
              </div>
              {menuItem('profile', 'user', '个人档案')}
              {menuItem('archive', 'archive', '存档')}
              {menuItem('trash', 'trash', '回收站')}
              {menuItem('settings', 'settings', '功能设置')}
              <div style={{ borderTop: '1px solid #f0f1f5', margin: '4px 0' }} />
              <button data-menu-item="logout" onClick={onLogout}
                style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '9px 14px', border: 'none',
                  background: 'none', cursor: 'pointer', fontSize: 13, color: '#e2445c', textAlign: 'left' }}>
                <Icon name="logout" size={16} color="#e2445c" />
                退出登录
              </button>
            </>
          )}

          {panel === 'profile' && (
            <>
              <PanelHeader title="个人档案" onBack={() => setPanel('menu')} />
              <div style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
                  <Avatar name={me?.name ?? ''} avatarUrl={me?.avatar_url} size={56} />
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#25272c' }}>{me?.name ?? '—'}</div>
                    <div style={{ fontSize: 12, color: '#7a7f8c' }}>{me?.department ?? '未分配部门'}</div>
                  </div>
                </div>
                {[
                  ['姓名', me?.name ?? '—'],
                  ['邮箱', me?.email ?? '—'],
                  ['部门', me?.department ?? '未分配部门'],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f0f1f5', fontSize: 13 }}>
                    <span style={{ color: '#a0a4b1' }}>{k}</span>
                    <span style={{ color: '#33333f', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {panel === 'archive' && (
            <>
              <PanelHeader title="存档（已归档 Board）" onBack={() => setPanel('menu')} />
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {archived.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#a0a4b1', fontSize: 13 }}>暂无已归档的 Board</div>}
                {archived.map((b) => (
                  <div key={b.id} data-archived-row={b.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f0f1f5' }}>
                    <Icon name="board" size={15} color="#7a7f8c" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</div>
                      <div style={{ fontSize: 11, color: '#a0a4b1' }}>{b.department_name ?? '—'}</div>
                    </div>
                    <button onClick={() => unarchive(b)} data-unarchive-btn style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#4f6ef7' }}>恢复</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {panel === 'trash' && (
            <>
              <PanelHeader title="回收站（已删条目）" onBack={() => setPanel('menu')} />
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {trash.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#a0a4b1', fontSize: 13 }}>回收站是空的</div>}
                {trash.map((t) => (
                  <div key={t.id} data-trash-row={t.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f0f1f5' }}>
                    <Icon name="trash" size={14} color="#a0a4b1" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: '#a0a4b1' }}>{t.board_name} · {t.deleted_at ? new Date(t.deleted_at).toLocaleDateString('zh-CN') : ''}</div>
                    </div>
                    <button onClick={() => restore(t)} data-restore-btn style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #e6e8ef', background: '#fff', cursor: 'pointer', fontSize: 12, color: '#4f6ef7' }}>恢复</button>
                  </div>
                ))}
              </div>
            </>
          )}

          {panel === 'settings' && (
            <>
              <PanelHeader title="功能设置" onBack={() => setPanel('menu')} />
              <div style={{ padding: 16, fontSize: 13, color: '#33333f', lineHeight: 1.8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f1f5' }}>
                  <span style={{ color: '#a0a4b1' }}>当前版本</span>
                  <span>Manday v0.1.0</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f1f5' }}>
                  <span style={{ color: '#a0a4b1' }}>AI 助手</span>
                  <span>已接入 WorkBuddy</span>
                </div>
                <div style={{ padding: '10px 0', fontSize: 12, color: '#a0a4b1' }}>
                  轻量版工作管理平台。更多设置项持续建设中。
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** 全局搜索按钮：触发 Cmd+K 面板 */
export function SearchButton() {
  return (
    <button data-search-btn onClick={() => window.dispatchEvent(new Event('manday:open-search'))} title="全局搜索（⌘K）"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'inline-flex', alignItems: 'center' }}>
      <Icon name="search" size={19} color="#5a6072" />
    </button>
  );
}

/** 退出登录（供 App 复用） */
export function logout() {
  clearToken();
  localStorage.removeItem('userId');
  location.reload();
}
