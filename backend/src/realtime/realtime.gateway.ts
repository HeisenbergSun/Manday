/**
 * 实时网关 — Socket.IO 房间模型（200 人规模：单节点足够）
 * 房间：board:{id}（Board 变更广播）、user:{id}（通知/@提及）
 */
import {
  WebSocketGateway, SubscribeMessage, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private online = new Map<string, string>(); // socketId -> userId

  handleConnection(socket: Socket) {
    // 身份来源：auth.userId > query > Authorization 头里的 JWT（生产应只信 JWT）
    const auth: any = socket.handshake.auth ?? {};
    const q: any = socket.handshake.query ?? {};
    let userId: string | undefined = auth.userId || q.userId;
    if (!userId) {
      const hdr = socket.handshake.headers?.authorization;
      if (hdr?.startsWith('Bearer ')) {
        try {
          const payload: any = jwt.decode(hdr.slice(7));
          userId = payload?.sub ?? payload?.userId ?? payload?.id;
        } catch { /* 忽略：按匿名处理 */ }
      }
    }
    if (!userId) return;              // 匿名连接不立即断开（避免前端无限重连刷 400），只是不订阅房间
    this.online.set(socket.id, userId as string);
    socket.join(`user:${userId}`);
  }
  handleDisconnect(socket: Socket) { this.online.delete(socket.id); }

  /** 前端进入 Board 页时按需订阅，离开时退出 */
  @SubscribeMessage('board:join')
  joinBoard(socket: Socket, boardId: string) { socket.join(`board:${boardId}`); }
  @SubscribeMessage('board:leave')
  leaveBoard(socket: Socket, boardId: string) { socket.leave(`board:${boardId}`); }

  /** ItemsService 写操作成功后调用：item 级 diff 推送，不整表刷新 */
  broadcastItemChange(boardId: string, payload: {
    type: 'item.update' | 'item.create' | 'item.delete';
    itemId: string; field?: string; value?: unknown; version?: number; userId: string;
  }) {
    this.server.to(`board:${boardId}`).emit('item:changed', payload);
  }

  /** 通知扇出（服务层会做每日聚合，此处只发实时触达） */
  notifyUser(userId: string, notification: unknown) {
    this.server.to(`user:${userId}`).emit('notification', notification);
  }

  onlineCount() { return this.online.size; }
}
