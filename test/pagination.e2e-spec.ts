/**
 * Pagination E2E: verifies that list endpoints return { data, meta } and
 * that PaginationQueryDto validation rejects bad params.
 *
 * Uses isolated testing modules — no real database required.
 */
import { INestApplication, ValidationPipe, CanActivate, ExecutionContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtModule } from '@nestjs/jwt';
import { ReservationsController } from '../src/reservations/reservations.controller';
import { ReservationsService } from '../src/reservations/reservations.service';
import { EmployeesController } from '../src/employees/employees.controller';
import { EmployeesService } from '../src/employees/employees.service';
import { NotificationsController } from '../src/notifications/notifications.controller';
import { NotificationsService } from '../src/notifications/notifications.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { EmployeeGuard } from '../src/common/guards/employee.guard';
import { AdminGuard } from '../src/common/guards/admin.guard';
import { OperationsEmployeeGuard } from '../src/common/guards/operations-employee.guard';

const ALLOW_ALL: CanActivate = { canActivate: (_ctx: ExecutionContext) => true };

const paginatedResponse = {
  data: [],
  meta: { total: 0, page: 1, limit: 15, totalPages: 1 },
};

// ─── Helper ──────────────────────────────────────────────────────────────────

async function buildIsolatedApp<T>(
  controller: new (...args: unknown[]) => T,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serviceClass: new (...args: any[]) => unknown,
  extraProviders: { provide: unknown; useValue: unknown }[] = [],
): Promise<INestApplication<App>> {
  const svc: Record<string, jest.Mock> = {
    findAll: jest.fn().mockResolvedValue(paginatedResponse),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findByResident: jest.fn(),
    findOneForUser: jest.fn(),
    createForUser: jest.fn(),
    updateForUser: jest.fn(),
    updateStatus: jest.fn(),
    markRead: jest.fn(),
    getStats: jest.fn(),
    deactivate: jest.fn(),
    activate: jest.fn(),
    assignApartment: jest.fn(),
    unassignApartment: jest.fn(),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({ secret: 'test' })],
    controllers: [controller],
    providers: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { provide: serviceClass as any, useValue: svc },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(extraProviders as any[]),
    ],
  })
    .overrideGuard(JwtAuthGuard).useValue(ALLOW_ALL)
    .overrideGuard(EmployeeGuard).useValue(ALLOW_ALL)
    .overrideGuard(AdminGuard).useValue(ALLOW_ALL)
    .overrideGuard(OperationsEmployeeGuard).useValue(ALLOW_ALL)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Reservations pagination (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildIsolatedApp(ReservationsController, ReservationsService);
  });
  afterAll(() => app.close());

  it('GET /reservations returns { data, meta }', async () => {
    const { body } = await request(app.getHttpServer()).get('/reservations').expect(200);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
    expect(body.meta).toMatchObject({ total: 0, page: 1, limit: 15, totalPages: 1 });
  });

  it('accepts ?page=2&limit=5', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/reservations?page=2&limit=5')
      .expect(200);
    expect(body.meta.page).toBe(1); // service mock returns fixed page=1
    expect(body).toHaveProperty('data');
  });

  it('GET /reservations?page=0 → 400', () =>
    request(app.getHttpServer()).get('/reservations?page=0').expect(400));

  it('GET /reservations?limit=1001 → 400', () =>
    request(app.getHttpServer()).get('/reservations?limit=1001').expect(400));

  it('GET /reservations?limit=abc → 400', () =>
    request(app.getHttpServer()).get('/reservations?limit=abc').expect(400));

  it('GET /reservations?page=-5 → 400', () =>
    request(app.getHttpServer()).get('/reservations?page=-5').expect(400));
});

describe('Employees pagination (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildIsolatedApp(EmployeesController, EmployeesService);
  });
  afterAll(() => app.close());

  it('GET /employees returns { data, meta }', async () => {
    const { body } = await request(app.getHttpServer()).get('/employees').expect(200);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
  });

  it('GET /employees?page=0 → 400', () =>
    request(app.getHttpServer()).get('/employees?page=0').expect(400));

  it('GET /employees?limit=0 → 400', () =>
    request(app.getHttpServer()).get('/employees?limit=0').expect(400));

  it('GET /employees?limit=1001 → 400', () =>
    request(app.getHttpServer()).get('/employees?limit=1001').expect(400));

  it('GET /employees?page=1&limit=50 → 200', () =>
    request(app.getHttpServer()).get('/employees?page=1&limit=50').expect(200));
});

describe('Notifications pagination (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await buildIsolatedApp(NotificationsController, NotificationsService);
  });
  afterAll(() => app.close());

  it('GET /notifications returns { data, meta }', async () => {
    const { body } = await request(app.getHttpServer()).get('/notifications').expect(200);
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('meta');
  });

  it('GET /notifications?limit=1000 → 200 (max allowed)', () =>
    request(app.getHttpServer()).get('/notifications?limit=1000').expect(200));

  it('GET /notifications?limit=1001 → 400', () =>
    request(app.getHttpServer()).get('/notifications?limit=1001').expect(400));
});

describe('PaginationQueryDto - valid defaults (e2e)', () => {
  let app: INestApplication<App>;
  let findAll: jest.Mock;

  beforeAll(async () => {
    findAll = jest.fn().mockResolvedValue(paginatedResponse);
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test' })],
      controllers: [EmployeesController],
      providers: [{ provide: EmployeesService, useValue: { findAll, findOne: jest.fn() } }],
    })
      .overrideGuard(JwtAuthGuard).useValue(ALLOW_ALL)
      .overrideGuard(AdminGuard).useValue(ALLOW_ALL)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });
  afterAll(() => app.close());

  it('uses page=1 limit=15 as defaults when no params', async () => {
    await request(app.getHttpServer()).get('/employees').expect(200);
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 15 }),
    );
  });

  it('passes page=3 limit=10 when provided', async () => {
    await request(app.getHttpServer()).get('/employees?page=3&limit=10').expect(200);
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ page: 3, limit: 10 }),
    );
  });
});
