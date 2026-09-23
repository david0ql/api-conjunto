import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

// Transliteración acento→base para la búsqueda: el usuario escribe "Andres" y
// debe encontrar "Andrés", "Nuñez" debe encontrar "Núñez", etc. 'translate()'
// exige que ambos strings tengan la MISMA longitud (80 = 80).
const UNACCENT_FROM =
  'áàâäãåāăąéèêëēėęíìîïīįóòôöõōőúùûüūűũñçýÿ' +
  'ÁÀÂÄÃÅĀĂĄÉÈÊËĒĖĘÍÌÎÏĪĮÓÒÔÖÕŌŐÚÙÛÜŪŰŨÑÇÝŸ';
const UNACCENT_TO =
  'aaaaaaaaaeeeeeeeiiiiiiooooooouuuuuuuncyy' +
  'AAAAAAAAAEEEEEEEIIIIIIOOOOOOOUUUUUUUNCYY';

/** Same mapping as UNACCENT_FROM/UNACCENT_TO, but evaluated in PostgreSQL. */
export function sqlUnaccent(column: string): string {
  return `translate(lower(${column}), '${UNACCENT_FROM}', '${UNACCENT_TO}')`;
}

/**
 * Normaliza un término como lo hace sqlUnaccent() en SQL: minúsculas sin
 * tildes, listo para comparar contra translate(lower(columna), ...).
 */
export function normalizeSearchTerm(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Escapa los comodines de LIKE para que "%" o "_" se busquen literalmente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Búsqueda por palabras, sin tildes ni mayúsculas: cada palabra del texto
 * debe aparecer en ALGUNA de las expresiones y TODAS las palabras deben
 * coincidir. Así "Ana Delia Cardenas", "Cardenas Ana" o "ana cárdenas"
 * encuentran a name="Ana Delia", last_name="Cárdenas" sin importar cómo se
 * repartió el nombre en la base.
 *
 * `expressions` son expresiones SQL de texto (columnas o subconsultas EXISTS
 * vía `existsFor`). `existsFor` recibe el nombre del parámetro de cada palabra
 * para construir condiciones sobre tablas relacionadas.
 */
export function applyTokenSearch<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  search: string | undefined,
  expressions: string[],
  existsFor?: (param: string) => string[],
): SelectQueryBuilder<T> {
  const terms = normalizeSearchTerm(search ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (terms.length === 0) return qb;

  const params: Record<string, string> = {};
  const conditions = terms.map((term, i) => {
    const p = `search_${i}`;
    params[p] = `%${escapeLike(term)}%`;
    const matches = [
      ...expressions.map((expr) => `${sqlUnaccent(expr)} ILIKE :${p}`),
      ...(existsFor?.(p) ?? []),
    ];
    return `(${matches.join(' OR ')})`;
  });

  return qb.andWhere(`(${conditions.join(' AND ')})`, params);
}
