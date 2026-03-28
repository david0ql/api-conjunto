import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Assembly } from './entities/assembly.entity';
import { AssemblyQuestion } from './entities/assembly-question.entity';
import { AssemblyVote } from './entities/assembly-vote.entity';
import { AssemblyResidentToken } from './entities/assembly-resident-token.entity';
import { Resident } from '../residents/entities/resident.entity';
import { AssembliesController } from './assemblies.controller';
import { AssembliesService } from './assemblies.service';
import { AssembliesGateway } from './assemblies.gateway';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? 'fallback-secret',
      }),
    }),
    TypeOrmModule.forFeature([
      Assembly,
      AssemblyQuestion,
      AssemblyVote,
      AssemblyResidentToken,
      Resident,
    ]),
  ],
  controllers: [AssembliesController],
  providers: [AssembliesService, AssembliesGateway],
  exports: [AssembliesService, AssembliesGateway],
})
export class AssembliesModule {}
