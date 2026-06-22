import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminGuard } from '../common/guards/admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { ResidentRegistrationsService } from './resident-registrations.service';

@Controller('resident-registrations')
export class ResidentRegistrationsController {
  constructor(private readonly service: ResidentRegistrationsService) {}

  // ─── Public ───────────────────────────────────────────────────────────────

  @Get('public/:publicId')
  getPublicLink(@Param('publicId') publicId: string) {
    return this.service.getPublicLink(publicId);
  }

  @Post('public/:publicId/submit')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: diskStorage({
        destination: (req, file, cb) => {
          const folder = file.fieldname === 'receiptPhoto'
            ? 'uploads/registrations/receipts'
            : 'uploads/registrations/persons';
          const fs = require('fs');
          if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
          cb(null, folder);
        },
        filename: (req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname)}`;
          cb(null, unique);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async submitRequest(
    @Param('publicId') publicId: string,
    @Body() body: Record<string, string>,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const receiptFile = files?.find((f) => f.fieldname === 'receiptPhoto');
    const personFiles = files?.filter((f) => f.fieldname === 'personPhoto') ?? [];

    const personsRaw: Array<{
      name: string; lastName: string; document: string; phone?: string;
      email?: string; birthDate?: string; isOwner: boolean; sortOrder: number;
    }> = JSON.parse(body.persons ?? '[]');

    const vehiclesRaw: Array<{
      vehicleType: string; brandName: string; model?: string; color?: string;
      plate: string; notes?: string;
    }> = JSON.parse(body.vehicles ?? '[]');

    const persons = personsRaw.map((p, i) => ({
      ...p,
      photoPath: personFiles[i]?.path,
    }));

    return this.service.submitRequest(publicId, {
      towerId: body.towerId,
      apartmentId: body.apartmentId,
      submittedLat: body.submittedLat ? parseFloat(body.submittedLat) : undefined,
      submittedLng: body.submittedLng ? parseFloat(body.submittedLng) : undefined,
      persons,
      vehicles: vehiclesRaw,
      receiptPhotoPath: receiptFile?.path,
    });
  }

  // ─── Admin: Links ─────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('links')
  findAllLinks() {
    return this.service.findAllLinks();
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('links')
  createLink(
    @Body() dto: { label: string; geofenceLat: number; geofenceLng: number; geofenceRadiusM: number },
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createLink(dto, user.sub);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Patch('links/:id/toggle')
  toggleLink(@Param('id') id: string) {
    return this.service.toggleLink(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Delete('links/:id')
  deleteLink(@Param('id') id: string) {
    return this.service.deleteLink(id);
  }

  // ─── Admin: Requests ──────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('requests')
  findAllRequests(
    @Query('status') status?: string,
    @Query('linkId') linkId?: string,
    @Query('apartmentId') apartmentId?: string,
  ) {
    return this.service.findAllRequests({ status, linkId, apartmentId });
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('requests/:id')
  findOneRequest(@Param('id') id: string) {
    return this.service.findOneRequest(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get('requests/:id/approval-preview')
  getApprovalPreview(@Param('id') id: string) {
    return this.service.getApprovalPreview(id);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('requests/:id/approve')
  approveRequest(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body('mode') mode?: 'replace' | 'merge',
  ) {
    return this.service.approveRequest(id, user.sub, mode === 'replace' ? 'replace' : 'merge');
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('requests/:id/reject')
  rejectRequest(
    @Param('id') id: string,
    @Body('rejectionReason') rejectionReason: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.rejectRequest(id, rejectionReason, user.sub);
  }
}
