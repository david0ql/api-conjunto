import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResidentVehicle } from './entities/resident-vehicle.entity';
import { ResidentVehiclesService } from './resident-vehicles.service';
import { ResidentVehiclesController } from './resident-vehicles.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ResidentVehicle])],
  controllers: [ResidentVehiclesController],
  providers: [ResidentVehiclesService],
  exports: [ResidentVehiclesService],
})
export class ResidentVehiclesModule {}
