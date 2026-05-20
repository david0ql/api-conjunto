import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import { Fine } from './entities/fine.entity';
import { FineType } from './entities/fine-type.entity';
import { CreateFineTypeDto } from './dto/create-fine-type.dto';
import { UpdateFineTypeValueDto } from './dto/update-fine-type-value.dto';
import { CreateFineDto } from './dto/create-fine.dto';
import { UpdateFineDto } from './dto/update-fine.dto';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Resident } from '../residents/entities/resident.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notification-types/entities/notification-type.entity';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { PaginatedResponse, paginate } from '../common/dto/paginated-response.dto';

type PdfDocument = InstanceType<typeof PDFDocument>;

interface FineFilters {
  towerId?: string;
  apartmentId?: string;
  residentId?: string;
  fineTypeId?: string;
  createdByEmployeeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable()
export class FinesService {
  private readonly logger = new Logger(FinesService.name);

  constructor(
    @InjectRepository(Fine)
    private readonly fineRepository: Repository<Fine>,
    @InjectRepository(FineType)
    private readonly fineTypeRepository: Repository<FineType>,
    @InjectRepository(Apartment)
    private readonly apartmentRepository: Repository<Apartment>,
    @InjectRepository(Resident)
    private readonly residentRepository: Repository<Resident>,
    @InjectRepository(NotificationType)
    private readonly notificationTypeRepository: Repository<NotificationType>,
    private readonly notificationsService: NotificationsService,
  ) {}

  findFineTypes(): Promise<FineType[]> {
    return this.fineTypeRepository.find({
      relations: ['createdByEmployee'],
      order: { name: 'ASC' },
    });
  }

  async createFineType(dto: CreateFineTypeDto, employeeId: string): Promise<FineType> {
    const item = this.fineTypeRepository.create({
      name: dto.name.trim(),
      value: dto.value,
      createdByEmployeeId: employeeId,
    });

    return this.fineTypeRepository.save(item);
  }

  async updateFineTypeValue(id: string, dto: UpdateFineTypeValueDto): Promise<FineType> {
    const item = await this.findFineTypeById(id);
    item.value = dto.value;
    return this.fineTypeRepository.save(item);
  }

  async findAll(filters: FineFilters = {}, query: PaginationQueryDto = {}): Promise<PaginatedResponse<Fine>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const [data, total] = await this.buildFineQuery(filters)
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return paginate(data, total, page, limit);
  }

  findAllUnpaginated(filters: FineFilters = {}): Promise<Fine[]> {
    return this.buildFineQuery(filters).getMany();
  }

  async findOne(id: string): Promise<Fine> {
    const item = await this.fineRepository.findOne({
      where: { id },
      relations: [
        'apartment',
        'apartment.towerData',
        'resident',
        'resident.apartment',
        'resident.apartment.towerData',
        'fineType',
        'createdByEmployee',
      ],
    });

    if (!item) {
      throw new NotFoundException(`Fine #${id} not found`);
    }

    return item;
  }

  async create(dto: CreateFineDto, employeeId: string): Promise<Fine> {
    const fineType = await this.findFineTypeById(dto.fineTypeId);
    const apartment = await this.apartmentRepository.findOne({ where: { id: dto.apartmentId } });
    if (!apartment) {
      throw new NotFoundException(`Apartment #${dto.apartmentId} not found`);
    }

    let residentId: string | null = null;
    if (dto.residentId) {
      const resident = await this.residentRepository.findOne({ where: { id: dto.residentId } });
      if (!resident) {
        throw new NotFoundException(`Resident #${dto.residentId} not found`);
      }
      if (resident.apartmentId !== dto.apartmentId) {
        throw new BadRequestException('El residente seleccionado no pertenece al apartamento');
      }
      residentId = resident.id;
    }

    const now = new Date();
    const amount = dto.amount ?? fineType.value;
    const item = this.fineRepository.create({
      apartmentId: dto.apartmentId,
      residentId,
      fineTypeId: dto.fineTypeId,
      fineTypeNameSnapshot: fineType.name,
      fineTypeValueSnapshot: fineType.value,
      amount,
      notes: dto.notes?.trim() || null,
      createdByEmployeeId: employeeId,
      createdYear: now.getFullYear(),
      createdMonth: now.getMonth() + 1,
    });

    const saved = await this.fineRepository.save(item);
    const created = await this.findOne(saved.id);
    await this.notifyResidentsForFine(created);
    return created;
  }

  async update(id: string, dto: UpdateFineDto): Promise<Fine> {
    const item = await this.findOne(id);

    if (dto.amount !== undefined) {
      item.amount = dto.amount;
    }

    if (dto.notes !== undefined) {
      item.notes = dto.notes?.trim() || null;
    }

    await this.fineRepository.save(item);
    return this.findOne(item.id);
  }

  private async findFineTypeById(id: string): Promise<FineType> {
    const item = await this.fineTypeRepository.findOne({ where: { id } });

    if (!item) {
      throw new NotFoundException(`FineType #${id} not found`);
    }

    return item;
  }

  async buildPdfReport(filters: FineFilters) {
    const fines = await this.findAllUnpaginated(filters);
    const doc = new PDFDocument({ margin: 34, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    const rangeLabel = `${filters.dateFrom ?? 'Inicio'} a ${filters.dateTo ?? 'Hoy'}`;
    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const totalAmount = fines.reduce((total, fine) => total + (Number(fine.amount) || 0), 0);

    doc.info.Title = `Reporte Multas - Conjunto Reserva de la Loma - ${rangeLabel}`;
    doc.info.Author = 'Conjunto Reserva de la Loma';
    doc.info.Subject = 'Reporte confidencial de multas';
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    this.drawPdfHeader(doc, rangeLabel, generatedAt);
    this.drawSummary(doc, fines.length, totalAmount);
    this.drawTableHeader(doc);

    fines.forEach((fine, index) => {
      this.ensurePdfSpace(doc, 34, rangeLabel, generatedAt);
      const apartment = this.getApartmentLabel(fine);
      const resident = fine.resident ? `${fine.resident.name} ${fine.resident.lastName}` : 'Apartamento';
      const typeName = fine.fineTypeNameSnapshot ?? fine.fineType?.name ?? 'Multa';
      const employee = fine.createdByEmployee
        ? `${fine.createdByEmployee.name} ${fine.createdByEmployee.lastName}`
        : 'Sin asignar';
      const date = fine.createdAt.toISOString().replace('T', ' ').slice(0, 16);
      const notes = fine.notes?.trim() || 'Sin notas';

      this.drawTableRow(
        doc,
        [
          date,
          apartment,
          resident,
          typeName,
          this.formatCurrency(fine.amount),
          employee,
          notes,
        ],
        index % 2 === 0,
      );
    });

    this.drawPdfFooter(doc);
    doc.end();

    await new Promise<void>((resolve) => {
      doc.on('end', () => resolve());
    });

    return Buffer.concat(chunks);
  }

  private buildFineQuery(filters: FineFilters) {
    const qb = this.fineRepository
      .createQueryBuilder('fine')
      .leftJoinAndSelect('fine.apartment', 'apartment')
      .leftJoinAndSelect('apartment.towerData', 'apartmentTower')
      .leftJoinAndSelect('fine.resident', 'resident')
      .leftJoinAndSelect('resident.apartment', 'residentApartment')
      .leftJoinAndSelect('residentApartment.towerData', 'residentApartmentTower')
      .leftJoinAndSelect('fine.fineType', 'fineType')
      .leftJoinAndSelect('fine.createdByEmployee', 'createdByEmployee')
      .orderBy('fine.createdAt', 'DESC');

    if (filters.towerId) {
      qb.andWhere('(apartment.tower_id = :towerId OR residentApartment.tower_id = :towerId)', {
        towerId: filters.towerId,
      });
    }

    if (filters.apartmentId) {
      qb.andWhere('(fine.apartment_id = :apartmentId OR resident.apartment_id = :apartmentId)', {
        apartmentId: filters.apartmentId,
      });
    }

    if (filters.residentId) {
      qb.andWhere('fine.resident_id = :residentId', { residentId: filters.residentId });
    }

    if (filters.fineTypeId) {
      qb.andWhere('fine.fine_type_id = :fineTypeId', { fineTypeId: filters.fineTypeId });
    }

    if (filters.createdByEmployeeId) {
      qb.andWhere('fine.created_by_employee_id = :createdByEmployeeId', {
        createdByEmployeeId: filters.createdByEmployeeId,
      });
    }

    if (filters.dateFrom) {
      qb.andWhere('fine.created_at >= :dateFrom', { dateFrom: `${filters.dateFrom}T00:00:00.000Z` });
    }

    if (filters.dateTo) {
      qb.andWhere('fine.created_at <= :dateTo', { dateTo: `${filters.dateTo}T23:59:59.999Z` });
    }

    return qb;
  }

  private async notifyResidentsForFine(fine: Fine): Promise<void> {
    if (!fine.apartmentId) {
      return;
    }

    const notificationType =
      (await this.notificationTypeRepository.findOne({ where: { code: 'fine' } })) ??
      (await this.notificationTypeRepository.findOne({ where: { code: 'general' } }));

    if (!notificationType) {
      this.logger.warn(`No se encontró tipo de notificación para multa ${fine.id}`);
      return;
    }

    const amount = Number.isFinite(fine.amount)
      ? new Intl.NumberFormat('es-CO', {
          style: 'currency',
          currency: 'COP',
          maximumFractionDigits: 0,
        }).format(fine.amount)
      : `${fine.amount}`;

    const fineName = fine.fineTypeNameSnapshot ?? fine.fineType?.name ?? 'Multa';
    const message = fine.notes?.trim()
      ? `Se registró una multa (${fineName}) por ${amount}. Detalle: ${fine.notes.trim()}`
      : `Se registró una multa (${fineName}) por ${amount}.`;

    try {
      await this.notificationsService.create({
        apartmentId: fine.apartmentId,
        notificationTypeId: notificationType.id,
        message,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No fue posible enviar notificación de multa ${fine.id}: ${reason}`);
    }
  }

  private getApartmentLabel(fine: Fine) {
    const apartment = fine.apartment ?? fine.resident?.apartment;
    const towerName = apartment?.towerData?.name ?? 'Torre';
    const number = apartment?.number ?? 'N/A';
    return `${towerName} - Apt. ${number}`;
  }

  private formatCurrency(value: number) {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  }

  private drawPdfHeader(doc: PdfDocument, rangeLabel: string, generatedAt: string) {
    doc
      .fillColor('#0f172a')
      .fontSize(16)
      .font('Helvetica-Bold')
      .text('Reporte de multas', 34, 28);
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#64748b')
      .text(`Rango: ${rangeLabel}`, 34, 49)
      .text(`Generado: ${generatedAt}`, 34, 62);
    doc.moveTo(34, 79).lineTo(doc.page.width - 34, 79).strokeColor('#e2e8f0').stroke();
    doc.y = 94;
  }

  private drawSummary(doc: PdfDocument, count: number, totalAmount: number) {
    const startY = doc.y;
    const boxWidth = 170;
    const gap = 10;
    const cards = [
      ['Multas en rango', String(count)],
      ['Valor total', this.formatCurrency(totalAmount)],
    ];

    cards.forEach(([label, value], index) => {
      const x = 34 + index * (boxWidth + gap);
      doc.roundedRect(x, startY, boxWidth, 42, 6).fillAndStroke('#f8fafc', '#e2e8f0');
      doc.fillColor('#64748b').fontSize(7).font('Helvetica-Bold').text(label.toUpperCase(), x + 10, startY + 9);
      doc.fillColor('#0f172a').fontSize(13).font('Helvetica-Bold').text(value, x + 10, startY + 23);
    });

    doc.y = startY + 62;
  }

  private drawTableHeader(doc: PdfDocument) {
    const headers = ['Fecha', 'Apartamento', 'Residente', 'Tipo', 'Valor', 'Asignado por', 'Notas'];
    const widths = [82, 100, 110, 130, 72, 105, 175];
    let x = 34;
    const y = doc.y;

    doc.rect(34, y, widths.reduce((sum, width) => sum + width, 0), 20).fill('#0f172a');
    headers.forEach((header, index) => {
      doc.fillColor('#ffffff').fontSize(7).font('Helvetica-Bold').text(header, x + 5, y + 7, {
        width: widths[index] - 10,
        lineBreak: false,
      });
      x += widths[index];
    });
    doc.y = y + 20;
  }

  private drawTableRow(doc: PdfDocument, values: string[], shaded: boolean) {
    const widths = [82, 100, 110, 130, 72, 105, 175];
    const rowHeight = 28;
    let x = 34;
    const y = doc.y;

    if (shaded) {
      doc.rect(34, y, widths.reduce((sum, width) => sum + width, 0), rowHeight).fill('#f8fafc');
    }

    values.forEach((value, index) => {
      doc.fillColor('#334155').fontSize(7).font('Helvetica').text(value, x + 5, y + 6, {
        width: widths[index] - 10,
        height: rowHeight - 8,
        ellipsis: true,
      });
      x += widths[index];
    });

    doc.moveTo(34, y + rowHeight).lineTo(808, y + rowHeight).strokeColor('#e2e8f0').stroke();
    doc.y = y + rowHeight;
  }

  private ensurePdfSpace(doc: PdfDocument, rowHeight: number, rangeLabel: string, generatedAt: string) {
    if (doc.y + rowHeight <= doc.page.height - doc.page.margins.bottom - 18) {
      return;
    }

    this.drawPdfFooter(doc);
    doc.addPage();
    this.drawPdfHeader(doc, rangeLabel, generatedAt);
    this.drawTableHeader(doc);
  }

  private drawPdfFooter(doc: PdfDocument) {
    const footerY = doc.page.height - doc.page.margins.bottom - 12;
    doc
      .fontSize(7)
      .fillColor('#94a3b8')
      .text('Conjunto Reserva de la Loma - documento confidencial', 34, footerY, {
        width: doc.page.width - 68,
        align: 'center',
      });
  }
}
