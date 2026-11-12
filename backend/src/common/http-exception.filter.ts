/**
 * 全局异常映射 — 把 service 层抛出的领域错误翻译成语义化 HTTP 状态码
 * CONFLICT→409（LWW 版本冲突，前端靠它提示刷新）；FORBIDDEN→403；NOT_FOUND→404
 */
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const msg = String(err?.message ?? '');
    const status = msg === 'CONFLICT' ? HttpStatus.CONFLICT
      : msg === 'FORBIDDEN' ? HttpStatus.FORBIDDEN
      : msg === 'NOT_FOUND' ? HttpStatus.NOT_FOUND
      : err instanceof HttpException ? err.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = err instanceof HttpException ? err.getResponse()
      : { statusCode: status, message: status >= 500 && process.env.NODE_ENV === 'production' ? 'Internal server error' : msg };
    res.status(status).json(body);
  }
}
