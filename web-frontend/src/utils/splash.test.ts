import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateSplash } from './chemistry';

// Expected values from the SPLASH reference implementation (github.com/berlinguyinca/spectra-hash,
// python/splash), run on the same peaks. Across 2,971 spectra (the RiPPository records, GNPS and
// litmine spectra, random and tied spectra) the port gave the reference's code every time.
const RECORD = join(__dirname, '../../../../RiPPository-data/RiPP-data/RIPPOS-0001.txt');
const peaks = (pairs: number[][]) => pairs.map(([mz, intensity]) => ({ mz, intensity }));

describe('SPLASH', () => {
  it('gives the reference code for a small spectrum', async () => {
    expect(await calculateSplash(peaks([[100, 50], [150.25, 999]]))).toBe('splash10-0udi-0900000000-c182238953726fa33212');
  });

  it('gives the reference code where intensities span seven orders and m/z runs past 1000', async () => {
    const random = [[473.622804, 5705949.258], [1001.3341, 575265.134], [574.53, 1], [1914.2853, 5], [227.87, 10],
      [2983.0885, 10], [1876.46, 5], [2816.23, 5], [629.2517, 999], [2285.7098, 4456868.736], [558.3627, 10],
      [139.74, 999], [2934.813331, 100], [345.655595, 100], [1651.3416, 10], [2072.59, 3427046.261], [2194.67, 10],
      [2946.19, 142551.303], [2230.4409, 1], [280.9201, 8705378.214], [2913.662048, 10], [164.36, 100],
      [40.7595, 999], [990.9, 10], [677.06, 100], [279.155, 5]];
    expect(await calculateSplash(peaks(random))).toBe('splash10-00e9-2090300000-653cd118c696bb93b717');
  });

  it('breaks a tie among the largest ions by m/z, as the reference does', async () => {
    const tied = [...Array.from({ length: 12 }, (_, k) => [1000.0 - 37.3 * k, 500]), [55, 100]];
    expect(await calculateSplash(peaks(tied))).toBe('splash10-0h0i-3000036996-baac62be437562556c72');
  });

  it('does not depend on the order the peaks are listed in', async () => {
    const list = peaks([[303.05, 10000], [147.063, 121.684], [449.108, 657.368]]);
    expect(await calculateSplash([...list].reverse())).toBe(await calculateSplash(list));
  });

  it.skipIf(!existsSync(RECORD))('gives the reference code for RIPPOS-0001', async () => {
    const lines = readFileSync(RECORD, 'utf-8').split('\n');
    const at = lines.indexOf('PK$PEAK: m/z int. rel.int.');
    const list = lines.slice(at + 1).filter((l) => l.startsWith('  ')).map((l) => l.trim().split(' ').map(Number));
    expect(await calculateSplash(peaks(list))).toBe('splash10-014i-0011790000-cb7564397f23258fb9fc');
  });

  it('gives nothing for an empty spectrum', async () => {
    expect(await calculateSplash([])).toBe('');
    expect(await calculateSplash(peaks([[100, 0]]))).toBe('');
  });
});
