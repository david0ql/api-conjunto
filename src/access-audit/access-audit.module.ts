import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuditService } from './access-audit.service';
import { AccessAuditController } from './access-audit.controller';
import { AccessAudit } from './entities/access-audit.entity';
import { ResidentsModule } from '../residents/residents.module';

@Module({
  imports: [TypeOrmModule.forFeature([AccessAudit]), ResidentsModule],
  controllers: [AccessAuditController],
  providers: [AccessAuditService],
  exports: [AccessAuditService],
})
export class AccessAuditModule {}
