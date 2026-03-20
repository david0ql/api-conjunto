import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { SnakeCaseNamingStrategy } from './common/strategies/snake-case.naming-strategy';
import { AuthModule } from './auth/auth.module';
import { ApartmentStatusesModule } from './apartment-statuses/apartment-statuses.module';
import { ResidentTypesModule } from './resident-types/resident-types.module';
import { VehicleTypesModule } from './vehicle-types/vehicle-types.module';
import { EmployeeRolesModule } from './employee-roles/employee-roles.module';
import { ReservationStatusesModule } from './reservation-statuses/reservation-statuses.module';
import { NotificationTypesModule } from './notification-types/notification-types.module';
import { ApartmentsModule } from './apartments/apartments.module';
import { ResidentsModule } from './residents/residents.module';
import { EmployeesModule } from './employees/employees.module';
import { VisitorsModule } from './visitors/visitors.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { ResidentApartmentsModule } from './resident-apartments/resident-apartments.module';
import { AccessAuditModule } from './access-audit/access-audit.module';
import { PoolEntriesModule } from './pool-entries/pool-entries.module';
import { CommonAreasModule } from './common-areas/common-areas.module';
import { ReservationsModule } from './reservations/reservations.module';
import { PackagesModule } from './packages/packages.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SystemLogsModule } from './system-logs/system-logs.module';

import { ApartmentStatus } from './apartment-statuses/entities/apartment-status.entity';
import { ResidentType } from './resident-types/entities/resident-type.entity';
import { VehicleType } from './vehicle-types/entities/vehicle-type.entity';
import { EmployeeRole } from './employee-roles/entities/employee-role.entity';
import { ReservationStatus } from './reservation-statuses/entities/reservation-status.entity';
import { NotificationType } from './notification-types/entities/notification-type.entity';
import { Apartment } from './apartments/entities/apartment.entity';
import { Resident } from './residents/entities/resident.entity';
import { Employee } from './employees/entities/employee.entity';
import { Visitor } from './visitors/entities/visitor.entity';
import { Vehicle } from './vehicles/entities/vehicle.entity';
import { ResidentApartment } from './resident-apartments/entities/resident-apartment.entity';
import { AccessAudit } from './access-audit/entities/access-audit.entity';
import { PoolEntry } from './pool-entries/entities/pool-entry.entity';
import { CommonArea } from './common-areas/entities/common-area.entity';
import { Reservation } from './reservations/entities/reservation.entity';
import { Package } from './packages/entities/package.entity';
import { Notification } from './notifications/entities/notification.entity';
import { SystemLog } from './system-logs/entities/system-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get('DATABASE_USER', 'conjunto'),
        password: config.get('DATABASE_PASSWORD', 'conjunto'),
        database: config.get('DATABASE_NAME', 'conjunto'),
        entities: [
          ApartmentStatus, ResidentType, VehicleType, EmployeeRole,
          ReservationStatus, NotificationType, Apartment, Resident,
          Employee, Visitor, Vehicle, ResidentApartment, AccessAudit,
          PoolEntry, CommonArea, Reservation, Package, Notification, SystemLog,
        ],
        synchronize: false,
        namingStrategy: new SnakeCaseNamingStrategy(),
        logging: config.get('NODE_ENV') !== 'production',
      }),
    }),
    CacheModule.register({ isGlobal: true }),
    AuthModule,
    ApartmentStatusesModule,
    ResidentTypesModule,
    VehicleTypesModule,
    EmployeeRolesModule,
    ReservationStatusesModule,
    NotificationTypesModule,
    ApartmentsModule,
    ResidentsModule,
    EmployeesModule,
    VisitorsModule,
    VehiclesModule,
    ResidentApartmentsModule,
    AccessAuditModule,
    PoolEntriesModule,
    CommonAreasModule,
    ReservationsModule,
    PackagesModule,
    NotificationsModule,
    SystemLogsModule,
  ],
})
export class AppModule {}
