import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResetThrottleGuard } from '../common/guards/reset-throttle.guard';
import { PasswordResetsController } from './password-resets.controller';
import { PasswordResetsService } from './password-resets.service';

@Module({
  imports: [TypeOrmModule.forFeature([PasswordResetToken, Resident])],
  controllers: [PasswordResetsController],
  providers: [PasswordResetsService, ResetThrottleGuard],
})
export class PasswordResetsModule {}
