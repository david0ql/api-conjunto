import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleBrand } from './entities/vehicle-brand.entity';
import { VehicleBrandsService } from './vehicle-brands.service';
import { VehicleBrandsController } from './vehicle-brands.controller';

@Module({
  imports: [TypeOrmModule.forFeature([VehicleBrand])],
  controllers: [VehicleBrandsController],
  providers: [VehicleBrandsService],
  exports: [VehicleBrandsService],
})
export class VehicleBrandsModule {}
