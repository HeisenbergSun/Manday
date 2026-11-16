/**
 * P3-2 附件模块
 */
import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';

@Module({
  controllers: [AttachmentsController],
})
export class AttachmentsModule {}
