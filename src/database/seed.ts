/**
 * Seed script — corre con: npm run seed
 * Popula la DB con datos dummy para desarrollo y testing.
 * Es idempotente: usa ON CONFLICT DO NOTHING donde es posible.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { SnakeCaseNamingStrategy } from '../common/strategies/snake-case.naming-strategy';

dotenv.config();

const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432'),
  username: process.env.DATABASE_USER ?? 'conjunto',
  password: process.env.DATABASE_PASSWORD ?? 'conjunto',
  database: process.env.DATABASE_NAME ?? 'conjunto',
  namingStrategy: new SnakeCaseNamingStrategy(),
  synchronize: false,
  logging: false,
});

async function seed() {
  await AppDataSource.initialize();
  const q = AppDataSource.query.bind(AppDataSource);

  console.log('🌱 Iniciando seed...\n');

  // ─── Leer catálogos semilla ──────────────────────────────────────
  const [occupiedStatus] = await q(`SELECT id FROM apartment_statuses WHERE code = 'occupied'`);
  const [vacantStatus]   = await q(`SELECT id FROM apartment_statuses WHERE code = 'vacant'`);
  const [ownerType]      = await q(`SELECT id FROM resident_types WHERE code = 'owner'`);
  const [tenantType]     = await q(`SELECT id FROM resident_types WHERE code = 'tenant'`);
  const [familyType]     = await q(`SELECT id FROM resident_types WHERE code = 'family'`);
  const [carType]        = await q(`SELECT id FROM vehicle_types WHERE code = 'car'`);
  const [motoType]       = await q(`SELECT id FROM vehicle_types WHERE code = 'motorcycle'`);
  const [adminRole]      = await q(`SELECT id FROM employee_roles WHERE code = 'administrator'`);
  const [porterRole]     = await q(`SELECT id FROM employee_roles WHERE code = 'porter'`);
  const [poolRole]       = await q(`SELECT id FROM employee_roles WHERE code = 'pool_attendant'`);
  const [pendingRes]     = await q(`SELECT id FROM reservation_statuses WHERE code = 'pending'`);
  const [approvedRes]    = await q(`SELECT id FROM reservation_statuses WHERE code = 'approved'`);
  const [pkgType]        = await q(`SELECT id FROM notification_types WHERE code = 'package'`);
  const [resType]        = await q(`SELECT id FROM notification_types WHERE code = 'reservation'`);
  const [genType]        = await q(`SELECT id FROM notification_types WHERE code = 'general'`);
  const [kiosco]         = await q(`SELECT id FROM common_areas WHERE name = 'kiosco'`);
  const [salon]          = await q(`SELECT id FROM common_areas WHERE name = 'salon_social'`);

  // ─── Employees ──────────────────────────────────────────────────
  console.log('👷 Creando empleados...');
  const adminHash  = await bcrypt.hash('admin123', 10);
  const porterHash = await bcrypt.hash('porter123', 10);
  const poolHash   = await bcrypt.hash('pool123', 10);

  await q(`
    INSERT INTO employees (id, name, last_name, document, username, password_hash, role_id, is_active)
    VALUES
      (uuidv7(), 'Carlos',  'Mendoza',  '10001001', 'admin',   $1, $2, true),
      (uuidv7(), 'Pedro',   'Ramirez',  '10002002', 'porter1', $3, $4, true),
      (uuidv7(), 'Lucia',   'Torres',   '10003003', 'pool1',   $5, $6, true)
    ON CONFLICT (username) DO NOTHING
  `, [adminHash, adminRole.id, porterHash, porterRole.id, poolHash, poolRole.id]);

  const [admin]   = await q(`SELECT id FROM employees WHERE username = 'admin'`);
  const [porter]  = await q(`SELECT id FROM employees WHERE username = 'porter1'`);
  const [poolAtt] = await q(`SELECT id FROM employees WHERE username = 'pool1'`);
  console.log(`   ✓ admin (${admin.id}), porter1, pool1`);

  // ─── Towers ──────────────────────────────────────────────────────
  console.log('🗼 Creando torres...');
  await q(`
    INSERT INTO towers (id, code, name, total_floors, apartments_per_floor, is_active)
    VALUES
      (uuidv7(), 'A', 'Torre A', 10, 10, true),
      (uuidv7(), 'B', 'Torre B', 10, 10, true),
      (uuidv7(), 'C', 'Torre C', 10, 10, true),
      (uuidv7(), 'D', 'Torre D', 10, 10, true),
      (uuidv7(), 'E', 'Torre E', 10, 10, true),
      (uuidv7(), 'F', 'Torre F', 10, 10, true),
      (uuidv7(), 'G', 'Torre G', 10, 10, true),
      (uuidv7(), 'H', 'Torre H', 10, 10, true),
      (uuidv7(), 'I', 'Torre I', 10, 10, true)
    ON CONFLICT (code) DO NOTHING
  `);
  console.log(`   ✓ 9 torres creadas`);

  // ─── Apartments ─────────────────────────────────────────────────
  console.log('🏢 Creando apartamentos...');
  await q(`
    INSERT INTO apartments (id, tower_id, number, tower, floor, area, status_id)
    SELECT
      uuidv7(),
      towers.id,
      (floors.floor_number::text || LPAD(units.unit_number::text, 2, '0')) AS number,
      towers.code,
      floors.floor_number,
      NULL,
      $1
    FROM towers
    CROSS JOIN generate_series(1, 10) AS floors(floor_number)
    CROSS JOIN generate_series(1, 10) AS units(unit_number)
    ON CONFLICT (tower_id, number) DO NOTHING
  `, [vacantStatus.id]);

  await q(`
    UPDATE apartments
    SET status_id = $1,
        area = CASE number
          WHEN '101' THEN 75.50
          WHEN '102' THEN 80.00
          WHEN '201' THEN 95.00
          ELSE area
        END
    WHERE tower = 'A'
      AND number IN ('101', '102', '201')
  `, [occupiedStatus.id]);

  await q(`
    UPDATE apartments
    SET area = 95.00
    WHERE tower = 'A'
      AND number = '202'
  `);

  await q(`
    UPDATE apartments
    SET area = 60.00,
        status_id = $1
    WHERE tower = 'B'
      AND number = '101'
  `, [occupiedStatus.id]);

  const [apt101A] = await q(`SELECT id FROM apartments WHERE tower='A' AND number='101'`);
  const [apt102A] = await q(`SELECT id FROM apartments WHERE tower='A' AND number='102'`);
  const [apt201A] = await q(`SELECT id FROM apartments WHERE tower='A' AND number='201'`);
  const [apt101B] = await q(`SELECT id FROM apartments WHERE tower='B' AND number='101'`);
  console.log(`   ✓ 900 apartamentos base + ajustes semilla`);

  // ─── Residents ──────────────────────────────────────────────────
  console.log('👤 Creando residentes...');
  const pass1 = await bcrypt.hash('resident123', 10);
  const pass2 = await bcrypt.hash('resident123', 10);
  const pass3 = await bcrypt.hash('resident123', 10);

  await q(`
    INSERT INTO residents (id, name, last_name, document, phone, email, password_hash, resident_type_id, is_active)
    VALUES
      (uuidv7(), 'Ana',      'Garcia',    '20001001', '3001234567', 'ana.garcia@email.com',    $1, $4, true),
      (uuidv7(), 'Juan',     'Perez',     '20002002', '3009876543', 'juan.perez@email.com',    $2, $5, true),
      (uuidv7(), 'Sofia',    'Herrera',   '20003003', '3005551234', 'sofia.herrera@email.com', $3, $6, true),
      (uuidv7(), 'Miguel',   'Lopez',     '20004004', '3007778888', 'miguel.lopez@email.com',  $1, $4, true),
      (uuidv7(), 'Daniela',  'Castillo',  '20005005', '3002223333', 'daniela.c@email.com',     $2, $5, true)
    ON CONFLICT (document) DO NOTHING
  `, [pass1, pass2, pass3, ownerType.id, tenantType.id, familyType.id]);

  const [ana]     = await q(`SELECT id FROM residents WHERE document = '20001001'`);
  const [juan]    = await q(`SELECT id FROM residents WHERE document = '20002002'`);
  const [sofia]   = await q(`SELECT id FROM residents WHERE document = '20003003'`);
  const [miguel]  = await q(`SELECT id FROM residents WHERE document = '20004004'`);
  const [daniela] = await q(`SELECT id FROM residents WHERE document = '20005005'`);
  console.log(`   ✓ ana.garcia, juan.perez, sofia.herrera, miguel.lopez, daniela.c`);

  // ─── Resident-Apartment links ────────────────────────────────────
  console.log('🔗 Vinculando residentes con apartamentos...');
  await q(`
    INSERT INTO resident_apartments (id, resident_id, apartment_id, start_date)
    VALUES
      (uuidv7(), $1, $6, '2024-01-01'),
      (uuidv7(), $2, $7, '2024-03-01'),
      (uuidv7(), $3, $8, '2023-06-01'),
      (uuidv7(), $4, $6, '2024-06-01'),
      (uuidv7(), $5, $9, '2024-07-01')
    ON CONFLICT DO NOTHING
  `, [ana.id, juan.id, sofia.id, miguel.id, daniela.id, apt101A.id, apt102A.id, apt201A.id, apt101B.id]);
  console.log(`   ✓ 5 vínculos creados`);

  // ─── Vehicles ───────────────────────────────────────────────────
  console.log('🚗 Creando vehículos...');
  await q(`
    INSERT INTO vehicles (id, plate, vehicle_type_id, resident_id, is_active)
    VALUES
      (uuidv7(), 'ABC123', $1, $3, true),
      (uuidv7(), 'XYZ789', $1, $4, true),
      (uuidv7(), 'MOT456', $2, $5, true)
    ON CONFLICT (plate) DO NOTHING
  `, [carType.id, motoType.id, ana.id, juan.id, sofia.id]);
  console.log(`   ✓ ABC123 (Ana), XYZ789 (Juan), MOT456 (Sofia)`);

  const [vABC] = await q(`SELECT id FROM vehicles WHERE plate = 'ABC123'`);
  const [vXYZ] = await q(`SELECT id FROM vehicles WHERE plate = 'XYZ789'`);

  // ─── Visitors ───────────────────────────────────────────────────
  console.log('🧑 Creando visitantes...');
  await q(`
    INSERT INTO visitors (id, name, last_name, document, phone)
    VALUES
      (uuidv7(), 'Roberto', 'Diaz',    '30001001', '3111234567'),
      (uuidv7(), 'Carmen',  'Vega',    '30002002', '3119876543'),
      (uuidv7(), 'Luis',    'Morales', '30003003', NULL)
    ON CONFLICT DO NOTHING
  `);

  const [vis1] = await q(`SELECT id FROM visitors WHERE document = '30001001'`);
  const [vis2] = await q(`SELECT id FROM visitors WHERE document = '30002002'`);
  console.log(`   ✓ Roberto Diaz, Carmen Vega, Luis Morales`);

  // ─── Access Audit ───────────────────────────────────────────────
  console.log('🚪 Creando registros de acceso...');
  await q(`
    INSERT INTO access_audit (id, resident_id, vehicle_id, apartment_id, entry_time, exit_time, authorized_by_employee_id, notes)
    VALUES
      (uuidv7(), $1, $3, $5, NOW() - INTERVAL '2 hours', NOW() - INTERVAL '30 minutes', $7, 'Entrada normal'),
      (uuidv7(), $2, $4, $6, NOW() - INTERVAL '1 hour',  NULL,                          $7, 'Residente aun adentro')
  `, [ana.id, juan.id, vABC.id, vXYZ.id, apt101A.id, apt102A.id, porter.id]);

  await q(`
    INSERT INTO access_audit (id, visitor_id, apartment_id, entry_time, authorized_by_employee_id, notes)
    VALUES
      (uuidv7(), $1, $2, NOW() - INTERVAL '3 hours', $3, 'Visita a apartamento A-101')
  `, [vis1.id, apt101A.id, porter.id]);

  await q(`
    INSERT INTO access_audit (id, visitor_id, apartment_id, entry_time, authorized_by_employee_id, notes)
    VALUES
      (uuidv7(), $1, $2, NOW() - INTERVAL '5 hours', $3, 'Visita sin vehiculo')
  `, [vis2.id, apt102A.id, porter.id]);
  console.log(`   ✓ 4 registros de acceso`);

  // ─── Pool Entries ───────────────────────────────────────────────
  console.log('🏊 Creando entradas a la piscina...');
  await q(`
    INSERT INTO pool_entries (id, apartment_id, entry_time, guest_count, created_by_employee_id, notes)
    VALUES
      (uuidv7(), $1, NOW() - INTERVAL '4 hours', 3, $3, 'Ingresaron dos residentes con tres invitados'),
      (uuidv7(), $2, NOW() - INTERVAL '2 hours', 0, $3, 'Ingreso individual'),
      (uuidv7(), $1, NOW() - INTERVAL '1 hour',  1, $3, 'Ingreso familiar corto')
  `, [apt101A.id, apt201A.id, poolAtt.id]);
  const poolEntries = await q(`
    SELECT id, apartment_id, entry_time
    FROM pool_entries
    WHERE created_by_employee_id = $1
    ORDER BY entry_time ASC
    LIMIT 3
  `, [poolAtt.id]);

  const firstPoolEntry = poolEntries[0];
  const thirdPoolEntry = poolEntries[2];

  if (firstPoolEntry?.id) {
    await q(`
      INSERT INTO pool_entry_residents (id, pool_entry_id, resident_id)
      VALUES
        (uuidv7(), $1, $2),
        (uuidv7(), $1, $3)
      ON CONFLICT DO NOTHING
    `, [firstPoolEntry.id, ana.id, miguel.id]);

    await q(`
      INSERT INTO pool_entry_guests (id, pool_entry_id, name)
      VALUES
        (uuidv7(), $1, 'Valentina Lopez'),
        (uuidv7(), $1, 'Martin Lopez'),
        (uuidv7(), $1, 'Laura Martinez')
      ON CONFLICT DO NOTHING
    `, [firstPoolEntry.id]);
  }

  if (poolEntries[1]?.id) {
    await q(`
      INSERT INTO pool_entry_residents (id, pool_entry_id, resident_id)
      VALUES
        (uuidv7(), $1, $2)
      ON CONFLICT DO NOTHING
    `, [poolEntries[1].id, sofia.id]);
  }

  if (thirdPoolEntry?.id) {
    await q(`
      INSERT INTO pool_entry_residents (id, pool_entry_id, resident_id)
      VALUES
        (uuidv7(), $1, $2)
      ON CONFLICT DO NOTHING
    `, [thirdPoolEntry.id, ana.id]);

    await q(`
      INSERT INTO pool_entry_guests (id, pool_entry_id, name)
      VALUES
        (uuidv7(), $1, 'Valentina Lopez')
      ON CONFLICT DO NOTHING
    `, [thirdPoolEntry.id]);
  }
  console.log(`   ✓ 3 entradas a piscina`);

  // ─── Reservations ───────────────────────────────────────────────
  console.log('📅 Creando reservas...');
  await q(`
    INSERT INTO reservations (id, resident_id, area_id, reservation_date, start_time, end_time, status_id, notes_by_resident)
    VALUES
      (uuidv7(), $1, $3, CURRENT_DATE + 3, '14:00', '18:00', $5, 'Cumpleaños de mi hijo'),
      (uuidv7(), $2, $4, CURRENT_DATE + 7, '10:00', '14:00', $6, 'Reunion de familia'),
      (uuidv7(), $1, $4, CURRENT_DATE - 5, '16:00', '20:00', $6, 'Evento pasado - aprobado')
  `, [ana.id, juan.id, kiosco.id, salon.id, pendingRes.id, approvedRes.id]);
  console.log(`   ✓ 2 reservas futuras + 1 pasada`);

  // ─── Packages ───────────────────────────────────────────────────
  console.log('📦 Creando paquetes...');
  await q(`
    INSERT INTO packages (id, resident_id, description, arrival_time, delivered, created_by_employee_id)
    VALUES
      (uuidv7(), $1, 'Caja Amazon mediana',      NOW() - INTERVAL '2 hours', false, $4),
      (uuidv7(), $2, 'Sobre de documentos',       NOW() - INTERVAL '1 day',  false, $4),
      (uuidv7(), $3, 'Paquete Mercado Libre grande', NOW() - INTERVAL '3 hours', false, $4)
  `, [ana.id, juan.id, sofia.id, porter.id]);

  // Mark one as delivered
  await q(`
    UPDATE packages
    SET delivered = true,
        delivered_time = NOW() - INTERVAL '30 minutes',
        received_by_resident_id = $1
    WHERE resident_id = $1
    AND description = 'Sobre de documentos'
  `, [juan.id]);
  console.log(`   ✓ 3 paquetes (1 entregado, 2 pendientes)`);

  const pendingPkgs = await q(`SELECT id FROM packages WHERE delivered = false LIMIT 1`);

  // ─── Notifications ──────────────────────────────────────────────
  console.log('🔔 Creando notificaciones...');
  await q(`
    INSERT INTO notifications (id, resident_id, notification_type_id, message, is_read)
    VALUES
      (uuidv7(), $1, $4, 'Tiene un paquete esperándole en portería: Caja Amazon mediana',          false),
      (uuidv7(), $1, $5, 'Su reserva del kiosco ha sido recibida y está pendiente de aprobación',  false),
      (uuidv7(), $2, $5, 'Su reserva del salón social ha sido aprobada para el ${new Date(Date.now() + 7*86400000).toISOString().split('T')[0]}', true),
      (uuidv7(), $3, $4, 'Paquete Mercado Libre grande llegó a portería',                          false),
      (uuidv7(), $1, $6, 'Recuerde: la reunión de copropietarios es el próximo martes a las 6pm',  false),
      (uuidv7(), $2, $6, 'Corte de agua programado el sábado de 8am a 12pm',                      true)
  `, [ana.id, juan.id, sofia.id, pkgType.id, resType.id, genType.id]);
  console.log(`   ✓ 6 notificaciones (3 no leídas para Ana, 1 para Sofia, 1 leída para Juan)`);

  // ─── System Logs ────────────────────────────────────────────────
  console.log('📋 Creando logs del sistema...');
  await q(`
    INSERT INTO system_logs (id, employee_id, action, entity, entity_id)
    VALUES
      (uuidv7(), $1, 'CREATE', 'residents', $3),
      (uuidv7(), $1, 'CREATE', 'residents', $4),
      (uuidv7(), $2, 'CREATE', 'access_audit', NULL),
      (uuidv7(), $2, 'CREATE', 'pool_entries', NULL),
      (uuidv7(), $1, 'UPDATE', 'reservations', NULL)
  `, [admin.id, porter.id, ana.id, juan.id]);
  console.log(`   ✓ 5 logs del sistema`);

  await AppDataSource.destroy();

  console.log('\n✅ Seed completado!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 Credenciales de acceso:');
  console.log('');
  console.log('  EMPLEADOS:');
  console.log('  usuario: admin    | password: admin123   | rol: administrator');
  console.log('  usuario: porter1  | password: porter123  | rol: porter');
  console.log('  usuario: pool1    | password: pool123    | rol: pool_attendant');
  console.log('');
  console.log('  RESIDENTES:');
  console.log('  email: ana.garcia@email.com    | password: resident123 | tipo: owner');
  console.log('  email: juan.perez@email.com    | password: resident123 | tipo: tenant');
  console.log('  email: sofia.herrera@email.com | password: resident123 | tipo: family');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

seed().catch((err) => {
  console.error('❌ Error en seed:', err);
  process.exit(1);
});
