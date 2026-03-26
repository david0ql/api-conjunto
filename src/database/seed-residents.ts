/**
 * Seed script: populate all 900 apartments with residents.
 * - All apartments get at least 1 resident via resident_apartments
 * - All residents get at least 1 apartment
 * - ~15% of residents have 2 apartments
 * - Also syncs residents.apartment_id with their first assigned apartment
 *
 * Run: node -r dotenv/config -e "require('./src/database/seed-residents').run()"
 * Or: ts-node -r tsconfig-paths/register src/database/seed-residents.ts
 */

import 'dotenv/config';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

const firstNames = [
  'Alejandro','Sofía','Carlos','Valentina','Juan','Isabella','Miguel','Camila',
  'Andrés','Daniela','Felipe','Juliana','Sebastián','Laura','Diego','Natalia',
  'Nicolás','Paula','Luis','Ana','Mateo','Sara','Esteban','María','Tomás','Lucía',
  'Rafael','Gabriela','Eduardo','Mariana','Fernando','Diana','Javier','Catalina',
  'Rodrigo','Claudia','Álvaro','Patricia','Mauricio','Melissa','César','Cristina',
  'Hernán','Johanna','Alberto','Mónica','Germán','Andrea','Ricardo','Lorena',
  'Santiago','Verónica','Gustavo','Paola','Leonardo','Carolina','Ramón','Elizabeth',
  'Oscar','Beatriz','Iván','Yolanda','Ernesto','Gloria','Fabio','Adriana',
  'Nelson','Liliana','Pedro','Esperanza','Jorge','Amparo','Víctor','Rocío',
  'Óscar','Jimena','Sergio','Nathalie','Antonio','Pilar','José','Olga',
  'Emilio','Silvia','Raúl','Isabel','Manuel','Elena','Gonzalo','Marta',
  'Agustín','Rosa','Edmundo','Teresa','Héctor','Consuelo','Patricio','Graciela',
];

const lastNames = [
  'García','Rodríguez','González','López','Martínez','Pérez','Sánchez','Ramírez',
  'Torres','Flores','Rivera','Gómez','Díaz','Reyes','Morales','Jiménez',
  'Herrera','Medina','Castro','Vargas','Ruiz','Ortiz','Álvarez','Ramos',
  'Romero','Mendoza','Guerrero','Delgado','Carrillo','Espinoza','Moreno',
  'Navarro','Cruz','Pacheco','Rivas','Rojas','Aguilar','Ríos','Campos',
  'Vásquez','Acosta','Parra','Valencia','Salazar','León','Peña','Bravo',
  'Arias','Gutiérrez','Fuentes','Castillo','Chávez','Muñoz','Silva','Soto',
  'Hurtado','Bermúdez','Lozano','Cárdenas','Pineda','Molina','Mejía','Osorio',
  'Suárez','Velásquez','Quiroz','Escobar','Castaño','Montoya','Trujillo','Duque',
  'Cifuentes','Patiño','Londoño','Ospina','Jaramillo','Arango','Zapata','Ossa',
  'Naranjo','Ocampo','Mesa','Correa','Gil','Niño','Avila','Bernal','Cano',
  'Daza','Forero','Galvis','Henao','Ibarra','Jara','Largo','Melo',
];

function randEl<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uuidv7Like(): string {
  return randomUUID();
}

async function run() {
  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT ?? '5432'),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });

  console.log('🔌 Connecting to database...');
  await pool.query('SELECT 1');
  console.log('✅ Connected\n');

  // 1. Get all apartments
  const { rows: apartments } = await pool.query<{ id: string; number: string; tower_code: string }>(
    `SELECT a.id, a.number, t.code AS tower_code
     FROM apartments a JOIN towers t ON a.tower_id = t.id
     ORDER BY t.code, a.number`,
  );
  console.log(`📦 Found ${apartments.length} apartments`);

  // 2. Get resident types
  const { rows: rtypes } = await pool.query('SELECT id, code FROM resident_types');
  const ownerTypeId = rtypes.find((r) => r.code === 'owner')?.id ?? rtypes[0].id;
  const tenantTypeId = rtypes.find((r) => r.code === 'tenant')?.id ?? rtypes[0].id;

  // 3. Clear existing resident_apartments (keep residents, re-assign)
  console.log('\n🧹 Clearing existing resident_apartments...');
  await pool.query('DELETE FROM resident_apartments');
  await pool.query("UPDATE residents SET apartment_id = NULL WHERE apartment_id IS NOT NULL");

  // 4. Get existing residents
  const { rows: existingResidents } = await pool.query(
    'SELECT id, name, last_name FROM residents WHERE is_active = true',
  );
  console.log(`👥 Existing residents: ${existingResidents.length}`);

  // 5. Calculate how many new residents we need
  // Strategy: 15% of residents get 2 apartments, 85% get 1
  // totalSlots = apartments.length = 900
  // Let X = total residents, 0.15X get 2 slots, 0.85X get 1 slot
  // 0.15X * 2 + 0.85X * 1 = 900 → 0.30X + 0.85X = 900 → 1.15X = 900 → X ≈ 782
  const targetResidents = Math.ceil(apartments.length / 1.15);
  const residentsNeeded = Math.max(0, targetResidents - existingResidents.length);
  console.log(`🎯 Target total residents: ${targetResidents}, need to create: ${residentsNeeded}`);

  // 6. Create new residents
  const passwordHash = await bcrypt.hash('123456', 10);
  const newResidentIds: string[] = [];

  if (residentsNeeded > 0) {
    console.log(`\n👤 Creating ${residentsNeeded} new residents...`);
    const BATCH = 100;
    for (let i = 0; i < residentsNeeded; i += BATCH) {
      const batch = Math.min(BATCH, residentsNeeded - i);
      const values: string[] = [];
      const params: any[] = [];
      let p = 1;

      for (let j = 0; j < batch; j++) {
        const name = randEl(firstNames);
        const lastName = randEl(lastNames);
        const idx = i + j + existingResidents.length + 1;
        const document = `DOC${String(idx).padStart(8, '0')}`;
        const email = `res${idx}@monolith.res`;
        const rtype = Math.random() < 0.6 ? ownerTypeId : tenantTypeId;
        const id = uuidv7Like();
        newResidentIds.push(id);

        values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        params.push(id, name, lastName, document, email, passwordHash, rtype, true);
      }

      await pool.query(
        `INSERT INTO residents (id, name, last_name, document, email, password_hash, resident_type_id, is_active)
         VALUES ${values.join(',')}
         ON CONFLICT DO NOTHING`,
        params,
      );

      if ((i + batch) % 200 === 0 || i + batch >= residentsNeeded) {
        process.stdout.write(`  Created ${Math.min(i + batch, residentsNeeded)}/${residentsNeeded}\r`);
      }
    }
    console.log(`\n✅ Created ${residentsNeeded} residents`);
  }

  // 7. Get all resident IDs (existing + new)
  const { rows: allResidents } = await pool.query('SELECT id FROM residents WHERE is_active = true ORDER BY created_at');
  const residentIds = allResidents.map((r: { id: string }) => r.id);
  console.log(`\n👥 Total residents: ${residentIds.length}`);

  // 8. Assign apartments
  // Shuffle residents and apartments for random assignment
  const shuffledResidents = [...residentIds].sort(() => Math.random() - 0.5);
  const shuffledApartments = [...apartments].sort(() => Math.random() - 0.5);

  // Decide which residents get 2 apartments (first 15% of shuffled)
  const multiApartmentCount = Math.floor(residentIds.length * 0.15);
  const multiResidents = new Set(shuffledResidents.slice(0, multiApartmentCount));

  // Build assignment map: residentId → [apartmentId, ...]
  const assignments = new Map<string, string[]>();
  let aptIdx = 0;

  // Each resident gets their primary apartment
  for (const resId of shuffledResidents) {
    if (aptIdx >= shuffledApartments.length) break;
    if (!assignments.has(resId)) assignments.set(resId, []);
    assignments.get(resId)!.push(shuffledApartments[aptIdx].id);
    aptIdx++;
  }

  // Multi-apartment residents get a second one
  for (const resId of multiResidents) {
    if (aptIdx >= shuffledApartments.length) break;
    assignments.get(resId)!.push(shuffledApartments[aptIdx].id);
    aptIdx++;
  }

  // Remaining apartments (if any) go to random residents
  while (aptIdx < shuffledApartments.length) {
    const resId = randEl(shuffledResidents);
    if (!assignments.has(resId)) assignments.set(resId, []);
    assignments.get(resId)!.push(shuffledApartments[aptIdx].id);
    aptIdx++;
  }

  console.log(`\n🏠 Inserting resident_apartments assignments...`);
  const raValues: string[] = [];
  const raParams: any[] = [];
  let rp = 1;

  for (const [resId, aptIds] of assignments) {
    for (const aptId of aptIds) {
      raValues.push(`($${rp++},$${rp++},$${rp++})`);
      raParams.push(uuidv7Like(), resId, aptId);
    }
  }

  const BATCH_SIZE = 500;
  for (let i = 0; i < raValues.length; i += BATCH_SIZE) {
    const batchValues = raValues.slice(i, i + BATCH_SIZE);
    const batchParams = raParams.slice(i * 3 / 1, (i + BATCH_SIZE) * 3);

    // Recalculate param indices for this batch
    const rebuildValues: string[] = [];
    const rebuildParams: any[] = [];
    let idx2 = 1;
    for (let j = 0; j < batchValues.length; j++) {
      rebuildValues.push(`($${idx2++},$${idx2++},$${idx2++})`);
      rebuildParams.push(raParams[(i + j) * 3], raParams[(i + j) * 3 + 1], raParams[(i + j) * 3 + 2]);
    }

    await pool.query(
      `INSERT INTO resident_apartments (id, resident_id, apartment_id)
       VALUES ${rebuildValues.join(',')}
       ON CONFLICT DO NOTHING`,
      rebuildParams,
    );
  }

  // 9. Update residents.apartment_id with their first assignment
  console.log('🔗 Updating residents.apartment_id (primary apartment)...');
  await pool.query(`
    UPDATE residents r
    SET apartment_id = (
      SELECT ra.apartment_id
      FROM resident_apartments ra
      WHERE ra.resident_id = r.id
      ORDER BY ra.created_at ASC
      LIMIT 1
    )
    WHERE EXISTS (
      SELECT 1 FROM resident_apartments ra WHERE ra.resident_id = r.id
    )
  `);

  // 10. Verify
  const { rows: [{ apt_count }] } = await pool.query(
    'SELECT COUNT(DISTINCT apartment_id) as apt_count FROM resident_apartments',
  );
  const { rows: [{ res_count }] } = await pool.query(
    'SELECT COUNT(DISTINCT resident_id) as res_count FROM resident_apartments',
  );
  const { rows: [{ multi_count }] } = await pool.query(
    'SELECT COUNT(*) as multi_count FROM (SELECT resident_id FROM resident_apartments GROUP BY resident_id HAVING COUNT(*) > 1) x',
  );
  const { rows: [{ total_count }] } = await pool.query(
    'SELECT COUNT(*) as total_count FROM resident_apartments',
  );

  console.log('\n✅ Seed complete!');
  console.log(`   Apartments assigned: ${apt_count} / ${apartments.length}`);
  console.log(`   Residents with apartments: ${res_count}`);
  console.log(`   Residents with multiple apartments: ${multi_count}`);
  console.log(`   Total assignment records: ${total_count}`);

  await pool.end();
}

run().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
