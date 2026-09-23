import { applyTokenSearch, normalizeSearchTerm } from './search';

const makeQb = () => ({
  andWhere: jest
    .fn<unknown, [string, Record<string, string>]>()
    .mockReturnThis(),
});

describe('normalizeSearchTerm', () => {
  it('removes accents, lowercases and trims', () => {
    expect(normalizeSearchTerm('  Ana Délia CÁRDENAS ')).toBe(
      'ana delia cardenas',
    );
  });
});

describe('applyTokenSearch', () => {
  it('does nothing for empty or blank searches', () => {
    const qb = makeQb();
    applyTokenSearch(qb as never, undefined, ['v.name']);
    applyTokenSearch(qb as never, '   ', ['v.name']);
    expect(qb.andWhere).not.toHaveBeenCalled();
  });

  it('requires every word to match some column (name + last name)', () => {
    const qb = makeQb();
    applyTokenSearch(qb as never, 'Ana Delia Cárdenas', [
      'v.name',
      'v.last_name',
    ]);
    const [sql, params] = qb.andWhere.mock.calls[0];
    expect(params).toEqual({
      search_0: '%ana%',
      search_1: '%delia%',
      search_2: '%cardenas%',
    });
    expect(sql.match(/ AND /g)).toHaveLength(2);
    expect(sql).toContain('v.last_name');
    expect(sql).toContain(':search_2');
  });

  it('escapes LIKE wildcards', () => {
    const qb = makeQb();
    applyTokenSearch(qb as never, '50%_off', ['n.message']);
    expect(qb.andWhere.mock.calls[0][1]).toEqual({ search_0: '%50\\%\\_off%' });
  });

  it('adds the extra EXISTS conditions per word', () => {
    const qb = makeQb();
    applyTokenSearch(qb as never, 'perez', ['a.number'], (p) => [
      `EXISTS (SELECT 1 WHERE x ILIKE :${p})`,
    ]);
    expect(qb.andWhere.mock.calls[0][0]).toContain(
      'EXISTS (SELECT 1 WHERE x ILIKE :search_0)',
    );
  });
});
