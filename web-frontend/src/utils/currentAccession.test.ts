import { describe, expect, it } from 'vitest';
import currentAccession from './currentAccession';

describe('an accession from a link or the search box', () => {
  it('leads an old RIPPOS-LU name to the record under its current name', () => {
    expect(currentAccession('RIPPOS-LU-0001')).toBe('RIPPOS-0001');
    expect(currentAccession('rippos-lu-0021')).toBe('RIPPOS-0021');
    expect(currentAccession(' RIPPOS-LU-0010 ')).toBe('RIPPOS-0010');
  });

  it('leaves current names and anything else as they are', () => {
    for (const a of ['RIPPOS-0001', 'MSBNK-IPB_Halle-PB001341', 'RIPPOS-LU-RP000001', 'RIPPOS-LU-1', '']) {
      expect(currentAccession(a)).toBe(a);
    }
    expect(currentAccession(null)).toBeNull();
  });
});
