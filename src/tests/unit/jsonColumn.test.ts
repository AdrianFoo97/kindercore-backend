import { describe, it, expect } from 'vitest';
import { fromJsonColumn } from '../../db/jsonColumn.js';

// JSON columns read the same whether the database hands back the value (MySQL)
// or its text (MariaDB, where JSON is LONGTEXT) — production crashed on the text.

describe('JSON columns on every database', () => {
  it('turns JSON text back into its value, and leaves values and non-JSON text alone', () => {
    expect(fromJsonColumn('[{"value":1,"label":"Poor"}]')).toEqual([{ value: 1, label: 'Poor' }]);
    expect(fromJsonColumn([1, 2])).toEqual([1, 2]);
    expect(fromJsonColumn({ max: 5 })).toEqual({ max: 5 });
    expect(fromJsonColumn(null)).toBeNull();
    expect(fromJsonColumn('not json')).toBe('not json');
  });
});
