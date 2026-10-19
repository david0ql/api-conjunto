import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PackagesService } from './packages.service';
import { PackagesController } from './packages.controller';
import { Package } from './entities/package.entity';
import { PackagePhoto } from './entities/package-photo.entity';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentPushModule } from '../resident-push/resident-push.module';

@Module({
  imports: [TypeOrmModule.forFeature([Package, PackagePhoto, ResidentApartment, Resident]), ResidentPushModule],
  controllers: [PackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
