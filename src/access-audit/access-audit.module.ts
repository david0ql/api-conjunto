import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccessAuditService } from './access-audit.service';
import { AccessAuditController } from './access-audit.controller';
import { AccessAudit } from './entities/access-audit.entity';
import { ResidentsModule } from '../residents/residents.module';
import { ResidentVehicle } from '../resident-vehicles/entities/resident-vehicle.entity';
import { Visitor } from '../visitors/entities/visitor.entity';
import { ResidentPushModule } from '../resident-push/resident-push.module';

@Module({
  imports: [TypeOrmModule.forFeature([AccessAudit, ResidentVehicle, Visitor]), ResidentsModule, ResidentPushModule],
  controllers: [AccessAuditController],
  providers: [AccessAuditService],
  exports: [AccessAuditService],
})
export class AccessAuditModule {}
