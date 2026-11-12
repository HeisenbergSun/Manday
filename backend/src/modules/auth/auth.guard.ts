/**
 * 全局鉴权守卫 — 除 /auth/* 与 /health 外全部要求有效 JWT
 * 权限语义：req.user.id 为唯一身份来源，AI 工具也透传它（无独立通道）
 */
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService, JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';

export const IS_PUBLIC = 'isPublic';
export const Public = () => (target: any, key?: any, desc?: any) => {
  Reflect.defineMetadata(IS_PUBLIC, true, desc?.value ?? target);
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(), context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException();
    try {
      const payload = this.jwt.verify(token);
      req.user = { id: payload.sub, email: payload.email, role: payload.role ?? 'member' };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'manday-dev-secret' })],
  providers: [
    // 全局守卫：除 @Public() 标记的 /auth/* 与 /health 外全部要求有效 JWT
    { provide: APP_GUARD, useClass: AuthGuard },
    AuthGuard,
  ],
  exports: [AuthGuard, JwtModule],
})
export class GuardModule {}
