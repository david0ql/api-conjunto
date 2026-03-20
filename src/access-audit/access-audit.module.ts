import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuditService } from './access-audit.service';
import { AccessAuditController } from './access-audit.controller';
import { AccessAudit } from './entities/access-audit.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AccessAudit])],
  controllers: [AccessAuditController],
  providers: [AccessAuditService],
  exports: [AccessAuditService],
})
export class AccessAuditModule {}
