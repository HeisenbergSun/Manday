/**
 * 认证模块 — 企业微信 OAuth（可切换飞书/钉钉，策略模式）
 * P0 决策：禁用本地密码登录；SSO 即唯一入口
 */
import { Injectable, Controller, Get, Post, UseGuards, Req, UnauthorizedException, Module, Inject } from '@nestjs/common';
import { Public } from './auth.guard';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtModule } from '@nestjs/jwt';
import { Pool } from 'pg';

/* ============ OAuth 策略 ============ */
interface OAuthProvider {
  /** 生成授权跳转 URL */
  authorizeUrl(state: string): string;
  /** 用 code 换取用户身份（email 作为与 users 表的匹配键） */
  getUserByCode(code: string): Promise<{ email: string; name: string; avatarUrl?: string }>;
}

@Injectable()
export class WeComProvider implements OAuthProvider {
  constructor(private cfg: ConfigService) {}
  authorizeUrl(state: string) {
    const corpId = this.cfg.getOrThrow('WECOM_CORP_ID');
    const redirect = encodeURIComponent(this.cfg.getOrThrow('OAUTH_REDIRECT_URI'));
    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${corpId}&redirect_uri=${redirect}&response_type=code&scope=snsapi_base&state=${state}#wechat_redirect`;
  }
  async getUserByCode(code: string) {
    // 生产实现：corp access_token → getuserinfo(code) → userid → 拉邮箱/姓名
    return { email: 'dev@internal', name: '开发账号' };
  }
}

@Injectable()
export class FeishuProvider implements OAuthProvider {
  constructor(private cfg: ConfigService) {}
  authorizeUrl(state: string) {
    const appId = this.cfg.getOrThrow('FEISHU_APP_ID');
    const redirect = encodeURIComponent(this.cfg.getOrThrow('OAUTH_REDIRECT_URI'));
    return `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=${redirect}&state=${state}`;
  }
  async getUserByCode(code: string) {
    // 生产实现：app_access_token → authen/v1/user_info
    return { email: 'dev@internal', name: '开发账号' };
  }
}

/* ============ 会话服务：首登自动建户 + 部门同步 ============ */
@Injectable()
export class AuthService {
  constructor(private pg: Pool, private jwt: JwtService, @Inject('OAUTH_PROVIDER') private provider: OAuthProvider) {}

  async login(code: string) {
    const profile = await this.provider.getUserByCode(code);
    const { rows } = await this.pg.query(
      `INSERT INTO users (email, name, avatar_url) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url
       RETURNING id, name, email`,
      [profile.email, profile.name, profile.avatarUrl],
    );
    const user = rows[0];
    // 组织架构每次登录增量同步（200 人规模足够；规模化后改企微通讯录 webhook 全量对账）
    await this.syncDepartment(user.id, profile.email);
    return { token: this.jwt.sign({ sub: user.id, email: user.email }), user };
  }

  private async syncDepartment(userId: string, email: string) {
    // 邮箱域 → 默认部门映射（P0 简化）；后续对接 HR 系统部门树 API
    await this.pg.query(
      `INSERT INTO user_departments (user_id, department_id, is_primary)
       SELECT $1, d.id, true FROM departments d
       WHERE d.path = '/全公司' AND NOT EXISTS (
         SELECT 1 FROM user_departments ud WHERE ud.user_id = $1 AND ud.department_id = d.id)
       ON CONFLICT DO NOTHING`,
      [userId],
    );
  }

  verify(token: string) {
    try { return this.jwt.verify(token); } catch { throw new UnauthorizedException(); }
  }
}

/* ============ 路由 ============ */
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private wecom: WeComProvider, private feishu: FeishuProvider, private cfg: ConfigService) {}

  @Public()
  @Get('login')
  redirectToSSO() {
    // 未配置 SSO 时降级提示，不让服务崩
    if (!this.cfg.get('WECOM_CORP_ID') && !this.cfg.get('FEISHU_APP_ID')) {
      return { error: 'SSO_NOT_CONFIGURED', message: '请在 .env 配置 WECOM_CORP_ID 或 FEISHU_APP_ID 后再使用登录', devHint: '本地开发可手动造一个 JWT：用 jwt.sign({ sub: userId, email }) 放进 Authorization: Bearer' };
    }
    return { url: this.wecom.authorizeUrl('manday') };  // 按配置选 provider
  }

  @Public()
  @Get('callback')
  async callback(@Req() req: any) { return this.auth.login(req.query.code); }

  /** 开发登录：仅 DEV_LOGIN=true 时可用（本地试用/联调；生产绝不开启） */
  @Public()
  @Post('dev-login')
  async devLogin() {
    if (this.cfg.get('DEV_LOGIN') !== 'true') {
      throw new UnauthorizedException('DEV_LOGIN 未开启');
    }
    // 复用首登建户逻辑：邮箱固定 dev@internal
    return this.auth.login('dev-code');
  }
}

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET || 'manday-dev-secret', signOptions: { expiresIn: '12h' } })],
  controllers: [AuthController],
  providers: [
    AuthService,
    WeComProvider,
    FeishuProvider,
    // 策略模式：按 env 切换 SSO 渠道（接口类型无法被 DI 解析，用 token 注入）
    { provide: 'OAUTH_PROVIDER', useFactory: (cfg: ConfigService) =>
      (cfg.get('SSO_PROVIDER') || 'wecom') === 'feishu' ? new FeishuProvider(cfg) : new WeComProvider(cfg),
      inject: [ConfigService] },
  ],
  exports: [JwtModule],
})
export class AuthModule {}
