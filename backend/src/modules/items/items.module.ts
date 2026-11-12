/**
 * Items 模块包装 — app.module 引用入口
 */
import { Module } from '@nestjs/common';
import { ItemsService } from './items.service';

@Module({
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
