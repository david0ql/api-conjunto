import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import PDFDocument from 'pdfkit';
import { In, Repository } from 'typeorm';
import { PoolEntry } from './entities/pool-entry.entity';
import { PoolEntryGuest } from './entities/pool-entry-guest.entity';
import { PoolEntryResident } from './entities/pool-entry-resident.entity';
import { CreatePoolEntryDto } from './dto/create-pool-entry.dto';
import { UpdatePoolEntryDto } from './dto/update-pool-entry.dto';
import { ResidentApartment } from '../resident-apartments/entities/resident-apartment.entity';
import { Apartment } from '../apartments/entities/apartment.entity';
import { Resident } from '../residents/entities/resident.entity';

type PoolReportFilters = {
  dateFrom?: string;
  dateTo?: string;
};

type PdfDocument = InstanceType<typeof PDFDocument>;
const PDF_FOOTER_RESERVE = 18;

@Injectable()
export class PoolEntriesService {
  constructor(
    @InjectRepository(PoolEntry)
    private repository: Repository<PoolEntry>,
    @InjectRepository(PoolEntryGuest)
    private guestsRepository: Repository<PoolEntryGuest>,
    @InjectRepository(PoolEntryResident)
    private residentLinksRepository: Repository<PoolEntryResident>,
    @InjectRepository(ResidentApartment)
    private residentApartmentsRepository: Repository<ResidentApartment>,
    @InjectRepository(Apartment)
    private apartmentsRepository: Repository<Apartment>,
  ) {}

  async findAll(): Promise<PoolEntry[]> {
    const entries = await this.repository.find({
      relations: ['apartment', 'residentLinks', 'residentLinks.resident', 'createdByEmployee', 'guests'],
      order: { entryTime: 'DESC' },
    });
    return entries.map((entry) => this.attachResidents(entry));
  }

  async findOne(id: string): Promise<PoolEntry> {
    const item = await this.repository.findOne({
      where: { id },
      relations: ['apartment', 'residentLinks', 'residentLinks.resident', 'createdByEmployee', 'guests'],
    });
    if (!item) throw new NotFoundException(`PoolEntry #${id} not found`);
    return this.attachResidents(item);
  }

  async create(dto: CreatePoolEntryDto): Promise<PoolEntry> {
    const guestNames = this.normalizeGuestNames(dto.guestNames);
    const residentIds = await this.validateResidentSelection(dto.apartmentId, dto.residentIds);
    const item = this.repository.create({
      apartmentId: dto.apartmentId,
      createdByEmployeeId: dto.createdByEmployeeId,
      notes: dto.notes,
      guestCount: guestNames.length,
      guests: guestNames.map((name) => this.guestsRepository.create({ name })),
      residentLinks: residentIds.map((residentId) =>
        this.residentLinksRepository.create({ residentId }),
      ),
    });
    const saved = await this.repository.save(item);
    return this.findOne(saved.id);
  }

  async update(id: string, dto: UpdatePoolEntryDto): Promise<PoolEntry> {
    const item = await this.findOne(id);
    const guestNames = this.normalizeGuestNames(dto.guestNames);
    const nextApartmentId = dto.apartmentId ?? item.apartmentId;
    const nextResidentIds = dto.residentIds ?? item.residentLinks.map((link) => link.residentId);

    if (dto.apartmentId !== undefined || dto.residentIds !== undefined) {
      const residentIds = await this.validateResidentSelection(nextApartmentId, nextResidentIds);
      await this.residentLinksRepository.delete({ poolEntryId: id });
      item.apartmentId = nextApartmentId;
      item.residentLinks = residentIds.map((residentId) =>
        this.residentLinksRepository.create({ poolEntryId: id, residentId }),
      );
    }

    item.notes = dto.notes ?? item.notes;

    if (dto.guestNames !== undefined) {
      await this.guestsRepository.delete({ poolEntryId: id });
      item.guests = guestNames.map((name) =>
        this.guestsRepository.create({ poolEntryId: id, name }),
      );
      item.guestCount = guestNames.length;
    }

    await this.repository.save(item);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const item = await this.findOne(id);
    await this.repository.remove(item);
  }

  async findResidentsByApartment(filters: {
    apartmentId?: string;
    tower?: string;
    number?: string;
  }) {
    const apartment = filters.apartmentId
      ? await this.apartmentsRepository.findOne({
          where: { id: filters.apartmentId },
          relations: ['status', 'towerData'],
        })
      : await this.apartmentsRepository.findOne({
          where: { tower: filters.tower, number: filters.number },
          relations: ['status', 'towerData'],
        });

    if (!apartment) {
      throw new NotFoundException('Apartment not found');
    }

    const residents = await this.residentApartmentsRepository.find({
      where: { apartmentId: apartment.id },
      relations: ['resident'],
      order: { createdAt: 'DESC' },
    });

    return {
      apartment,
      residents: residents.map((item) => item.resident),
    };
  }

  async getGuestSuggestions(query?: string) {
    const qb = this.guestsRepository
      .createQueryBuilder('guest')
      .select('guest.name', 'name')
      .addSelect('COUNT(*)::int', 'uses')
      .groupBy('guest.name')
      .orderBy('uses', 'DESC')
      .addOrderBy('guest.name', 'ASC')
      .limit(12);

    if (query?.trim()) {
      qb.where('guest.name ILIKE :query', { query: `%${query.trim()}%` });
    }

    return qb.getRawMany<{ name: string; uses: number }>();
  }

  async getSummary(filters: PoolReportFilters) {
    const entries = await this.findByDateRange(filters);
    const today = new Date().toISOString().slice(0, 10);
    const entriesToday = entries.filter((item) => item.entryTime.toISOString().slice(0, 10) === today);
    const guestsToday = entriesToday.reduce((total, item) => total + item.guestCount, 0);
    const uniqueResidents = new Set(
      entries.flatMap((item) => item.residentLinks.map((link) => link.residentId)),
    ).size;
    const topGuests = this.getTopGuests(entries);

    return {
      entriesToday: entriesToday.length,
      guestsToday,
      entriesInRange: entries.length,
      guestsInRange: entries.reduce((total, item) => total + item.guestCount, 0),
      uniqueResidents,
      topGuests,
    };
  }

  async buildPdfReport(filters: PoolReportFilters) {
    const entries = await this.findByDateRange(filters);
    const summary = await this.getSummary(filters);
    const doc = new PDFDocument({ margin: 34, size: 'A4', layout: 'landscape' });
    const chunks: Buffer[] = [];
    const rangeLabel = `${filters.dateFrom ?? 'Inicio'} a ${filters.dateTo ?? 'Hoy'}`;
    const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16);
    doc.info.Title = `Reporte Piscina - Conjunto Reserva de la Loma - ${rangeLabel}`;
    doc.info.Author = 'Conjunto Reserva de la Loma';
    doc.info.Subject = 'Reporte confidencial de ingresos a piscina';

    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

    this.drawPdfHeader(doc, rangeLabel, generatedAt);
    this.drawSummaryTable(doc, summary, entries.length);
    this.drawTableHeader(doc);

    let rowIndex = 0;
    for (const entry of entries) {
      const apartment = this.getApartmentLabel(entry.apartment);
      const residentName = this.getResidentNames(entry.residents);
      const dateLabel = entry.entryTime.toISOString().replace('T', ' ').slice(0, 16);
      const guestNames =
        entry.guests?.map((guest) => guest.name).join(', ') || 'Sin invitados';
      const notes = entry.notes?.trim() || 'Sin notas';

      const rowHeight = this.calculateRowHeight(doc, [residentName, apartment, dateLabel, guestNames, notes]);
      this.ensureTablePage(doc, rowHeight, rangeLabel, generatedAt);
      this.drawTableRow(
        doc,
        [residentName, apartment, dateLabel, guestNames, notes],
        rowIndex % 2 === 0,
        rowHeight,
      );
      rowIndex += 1;
    }

    this.drawPdfFooter(doc);
    doc.end();

    await new Promise<void>((resolve) => {
      doc.on('end', () => resolve());
    });

    return Buffer.concat(chunks);
  }

  private async findByDateRange(filters: PoolReportFilters) {
    const qb = this.repository.createQueryBuilder('entry')
      .leftJoinAndSelect('entry.apartment', 'apartment')
      .leftJoinAndSelect('entry.residentLinks', 'resident_links')
      .leftJoinAndSelect('resident_links.resident', 'resident')
      .leftJoinAndSelect('entry.createdByEmployee', 'employee')
      .leftJoinAndSelect('entry.guests', 'guests')
      .orderBy('entry.entryTime', 'DESC');

    if (filters.dateFrom) {
      qb.andWhere('entry.entry_time >= :dateFrom', { dateFrom: `${filters.dateFrom}T00:00:00.000Z` });
    }

    if (filters.dateTo) {
      qb.andWhere('entry.entry_time <= :dateTo', { dateTo: `${filters.dateTo}T23:59:59.999Z` });
    }

    const entries = await qb.getMany();
    return entries.map((entry) => this.attachResidents(entry));
  }

  private normalizeGuestNames(guestNames?: string[]) {
    return (guestNames ?? [])
      .map((name) => name.trim())
      .filter(Boolean);
  }

  private attachResidents(entry: PoolEntry) {
    entry.residents = (entry.residentLinks ?? [])
      .map((link) => link.resident)
      .filter((resident): resident is Resident => Boolean(resident));
    return entry;
  }

  private async validateResidentSelection(apartmentId: string, residentIds: string[]) {
    const normalizedResidentIds = [...new Set(residentIds)];

    if (normalizedResidentIds.length === 0) {
      throw new BadRequestException('Debes seleccionar al menos un residente');
    }

    const apartment = await this.apartmentsRepository.findOne({
      where: { id: apartmentId },
    });

    if (!apartment) {
      throw new NotFoundException(`Apartment #${apartmentId} not found`);
    }

    const links = await this.residentApartmentsRepository.find({
      where: {
        apartmentId,
        residentId: In(normalizedResidentIds),
      },
    });

    if (links.length !== normalizedResidentIds.length) {
      throw new BadRequestException(
        'Todos los residentes seleccionados deben pertenecer al apartamento indicado',
      );
    }

    return normalizedResidentIds;
  }

  private getTopGuests(entries: PoolEntry[]) {
    const counter = entries.reduce<Record<string, number>>((accumulator, entry) => {
      for (const guest of entry.guests ?? []) {
        accumulator[guest.name] = (accumulator[guest.name] ?? 0) + 1;
      }

      return accumulator;
    }, {});

    return Object.entries(counter)
      .map(([name, uses]) => ({ name, uses }))
      .sort((first, second) => second.uses - first.uses || first.name.localeCompare(second.name))
      .slice(0, 8);
  }

  private getResidentNames(residents?: Resident[]) {
    if (!residents?.length) {
      return 'Sin residentes';
    }

    return residents
      .map((resident) => `${resident.name} ${resident.lastName}`.trim())
      .join(', ');
  }

  private getApartmentLabel(apartment?: Apartment) {
    if (!apartment) {
      return 'Sin apartamento';
    }

    return `Torre ${apartment.tower ?? '-'} · ${apartment.number}`;
  }

  private drawPdfHeader(doc: PdfDocument, rangeLabel: string, generatedAt: string) {
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const top = 28;

    doc
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#111111')
      .text('Conjunto Reserva de la Loma', left, top, { width: 360 });

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#111111')
      .text('Reporte de Ingresos a Piscina', left, top + 24, { width: 320 });

    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#5c5c5c')
      .text('Documento confidencial para control operativo y administrativo.', left, top + 43, {
        width: 360,
      });

    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#3f3f3f')
      .text(`Rango: ${rangeLabel}`, left + 430, top + 6, {
        width: 190,
        align: 'right',
      });

    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#3f3f3f')
      .text(`Fecha de creación: ${generatedAt}`, left + 430, top + 22, {
        width: 190,
        align: 'right',
      });

    doc
      .moveTo(left, top + 66)
      .lineTo(left + pageWidth, top + 66)
      .lineWidth(1)
      .strokeColor('#111111')
      .stroke();

    doc.y = top + 78;
  }

  private drawSummaryTable(
    doc: PdfDocument,
    summary: Awaited<ReturnType<PoolEntriesService['getSummary']>>,
    exportableEntries: number,
  ) {
    const startY = doc.y;
    const left = doc.page.margins.left;
    const columns = [
      { label: 'Indicador', width: 150 },
      { label: 'Valor', width: 80 },
      { label: 'Detalle', width: 470 },
    ];
    const rows = [
      ['Entradas en el rango', `${summary.entriesInRange}`, 'Cantidad total de registros que cumplen el período seleccionado.'],
      ['Invitados en el rango', `${summary.guestsInRange}`, 'Total de acompañantes nominales vinculados a los ingresos.'],
      ['Residentes únicos', `${summary.uniqueResidents}`, 'Número de residentes distintos presentes dentro del período analizado.'],
    ];

    doc
      .font('Helvetica-Bold')
      .fontSize(10.5)
      .fillColor('#111111')
      .text('Resumen ejecutivo del período', left, startY);

    let currentY = startY + 18;
    let currentX = left;
    doc.rect(left, currentY, 700, 22).fill('#111111');
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff');
    columns.forEach((column) => {
      this.drawCenteredCellText(doc, column.label.toUpperCase(), currentX + 8, currentY, column.width - 10, 22, {
        font: 'Helvetica-Bold',
        fontSize: 8.5,
        color: '#ffffff',
      });
      currentX += column.width;
    });

    currentY += 22;
    rows.forEach((row, rowIndex) => {
      currentX = left;
      const rowHeight = 24;
      doc
        .rect(left, currentY, 700, rowHeight)
        .fillAndStroke(rowIndex % 2 === 0 ? '#f7f7f7' : '#ffffff', '#d5d5d5');
      row.forEach((value, index) => {
        this.drawCenteredCellText(doc, value, currentX + 8, currentY, columns[index].width - 12, rowHeight, {
          font: 'Helvetica',
          fontSize: 8.5,
          color: '#111111',
        });
        currentX += columns[index].width;
      });
      currentY += rowHeight;
    });

    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#666666')
      .text(
        'Detalle consolidado de residentes, apartamento, fecha y hora, invitados y observaciones operativas.',
        left,
        currentY + 12,
      );

    doc.y = currentY + 30;
  }

  private drawTableHeader(doc: PdfDocument) {
    const y = doc.y;
    const columns = [
      { label: 'Residentes', x: 34, width: 210 },
      { label: 'Apartamento', x: 244, width: 100 },
      { label: 'Fecha / Hora', x: 344, width: 120 },
      { label: 'Invitados', x: 464, width: 210 },
      { label: 'Notas', x: 674, width: 117 },
    ];

    doc.rect(34, y, 757, 24).fill('#111111');

    columns.forEach((column) => {
      this.drawCenteredCellText(doc, column.label.toUpperCase(), column.x + 8, y, column.width - 12, 24, {
        font: 'Helvetica-Bold',
        fontSize: 8,
        color: '#ffffff',
      });
    });

    doc.y = y + 24;
  }

  private ensureTablePage(doc: PdfDocument, rowHeight: number, rangeLabel: string, generatedAt: string) {
    if (doc.y + rowHeight + 12 <= doc.page.height - doc.page.margins.bottom - PDF_FOOTER_RESERVE) {
      return;
    }

    doc.addPage();
    this.drawPdfHeader(doc, rangeLabel, generatedAt);
    this.drawTableHeader(doc);
  }

  private calculateRowHeight(doc: PdfDocument, values: string[]) {
    const widths = [194, 88, 108, 198, 105];
    doc.font('Helvetica').fontSize(8.5);
    const heights = values.map((value, index) =>
      doc.heightOfString(value, {
        width: widths[index],
        align: 'left',
      }),
    );

    return Math.max(30, Math.max(...heights) + 14);
  }

  private drawTableRow(doc: PdfDocument, values: string[], shaded: boolean, rowHeight: number) {
    const y = doc.y;
    const columns = [
      { x: 34, width: 210 },
      { x: 244, width: 100 },
      { x: 344, width: 120 },
      { x: 464, width: 210 },
      { x: 674, width: 117 },
    ];

    doc
      .rect(34, y, 757, rowHeight)
      .fillAndStroke(shaded ? '#f7f7f7' : '#ffffff', '#dcdcdc');

    values.forEach((value, index) => {
      this.drawCenteredCellText(doc, value, columns[index].x + 8, y, columns[index].width - 12, rowHeight, {
        font: 'Helvetica',
        fontSize: 8.5,
        color: '#1a1a1a',
      });
    });

    doc.y = y + rowHeight;
  }

  private drawPdfFooter(doc: PdfDocument) {
    const footerY = doc.page.height - doc.page.margins.bottom - PDF_FOOTER_RESERVE;
    doc
      .font('Helvetica')
      .fontSize(7.2)
      .fillColor('#777777')
      .text(
        'Conjunto Reserva de la Loma · Documento confidencial de uso interno.',
        34,
        footerY,
        { align: 'center', width: 757, lineBreak: false },
      );
  }

  private drawCenteredCellText(
    doc: PdfDocument,
    text: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options: {
      font: string;
      fontSize: number;
      color: string;
    },
  ) {
    doc.font(options.font).fontSize(options.fontSize).fillColor(options.color);
    const textHeight = doc.heightOfString(text, {
      width,
      align: 'center',
    });
    const topOffset = Math.max(0, (height - textHeight) / 2);

    doc.text(text, x, y + topOffset, {
      width,
      align: 'center',
    });
  }
}
