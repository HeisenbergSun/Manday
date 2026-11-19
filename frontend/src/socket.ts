/**
 * 实时订阅 — Board 房间模型，item 级 diff 局部更新
 */
import { io } from 'socket.io-client';
import { useItems } from './store';

export const socket = io('/', { auth: { userId: localStorage.getItem('userId') }, withCredentials: true });

// #60 断线重连自动 refetch：记录当前 board，重连成功后重新 join + 通知 App 全量刷新
let currentBoardId: string | null = null;
let wasDisconnected = false;

export function joinBoard(boardId: string) {
  currentBoardId = boardId;
  socket.emit('board:join', boardId);
  socket.on('item:changed', (p: {
    type: string; itemId: string; field?: string; value?: unknown; version?: number;
  }) => {
    const store = useItems.getState();
    switch (p.type) {
      case 'item.update':
        store.applyPatch(p.itemId, p.field!, p.value, p.version!);
        break;
      // item.create / item.delete 在此增量处理，不整表刷新
    }
  });

  // 高优先级通知实时推送（替代轮询）：Web Notification + 铃铛事件
  socket.on('notification', (n: { type: string; payload: unknown }) => {
    window.dispatchEvent(new CustomEvent('manday:notification', { detail: n }));
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Manday', { body: n.type === 'mention' ? '有人 @ 了你' : '你有新通知' });
    }
  });
}

export function leaveBoard(boardId: string) {
  socket.emit('board:leave', boardId);
  socket.off('item:changed');
}

// 断线自动重连退避（蓝绿发布切换时前端无感恢复）
socket.on('disconnect', () => { wasDisconnected = true; setTimeout(() => socket.connect(), 1000 + Math.random() * 2000); });

// 重连成功：服务端房间已丢失 → 重新 join，并通知 App 全量 refetch 补齐断线期间错过的变更
socket.on('connect', () => {
  if (!wasDisconnected) return;
  wasDisconnected = false;
  if (currentBoardId) {
    socket.emit('board:join', currentBoardId);
    window.dispatchEvent(new CustomEvent('manday:reconnected', { detail: currentBoardId }));
  }
});
