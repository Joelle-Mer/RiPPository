import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { centroid, looksLikeProfile, toPeakList, type Point } from './centroid';

const DATA = join(__dirname, '../../../../../../../RiPPository-data/RiPP-data');

// An Orbitrap-like profile: Gaussian peaks whose width grows with m/z (resolution 60,000 at m/z 200,
// falling with the square root of m/z), sampled at a step that also grows with m/z, with zero points
// between peaks as Thermo exports them. The true centres are known, so the conversion can be scored.
function profile(peaks: Point[], phase = 0.37) {
  const pts: Point[] = [];
  for (const p of peaks) {
    const fwhm = p.mz / (60000 * Math.sqrt(200 / p.mz));
    const sigma = fwhm / 2.3548;
    const step = fwhm / 3.2;
    for (let k = -6; k <= 6; k++) {
      const mz = p.mz + (k + phase - 0.5) * step;
      const y = p.intensity * Math.exp(-((mz - p.mz) ** 2) / (2 * sigma * sigma));
      pts.push({ mz, intensity: y > p.intensity * 1e-3 ? y : 0 });
    }
  }
  return pts.sort((a, b) => a.mz - b.mz);
}
const ppm = (a: number, b: number) => ((a - b) / b) * 1e6;
const truth: Point[] = [
  { mz: 147.0764, intensity: 2e5 }, { mz: 303.0501, intensity: 1e6 }, { mz: 570.3358, intensity: 2.4e8 },
  { mz: 570.6703, intensity: 2.0e8 }, { mz: 571.0047, intensity: 1.0e8 }, // isotopes of a 3+ ion
  { mz: 1209.6431, intensity: 5e5 }, { mz: 1951.0712, intensity: 3e4 },
];

describe('profile data turned into peaks', () => {
  it('finds every peak at its true centre, to well under 1 ppm', () => {
    for (const phase of [0, 0.2, 0.37, 0.5, 0.81]) {
      const got = centroid(profile(truth, phase));
      expect(got).toHaveLength(truth.length);
      truth.forEach((t, i) => {
        expect(Math.abs(ppm(got[i].mz, t.mz))).toBeLessThan(0.2);
        expect(got[i].intensity / t.intensity).toBeGreaterThan(0.99);
        expect(got[i].intensity / t.intensity).toBeLessThan(1.01);
      });
    }
  });

  // the control: the plain highest point of each peak is off by up to half a sampling step, so the
  // 0.2 ppm above is something only a real centre estimate passes
  it('does better than taking the highest point, which the test above would catch', () => {
    const pts = profile(truth, 0.81);
    const worstApex = Math.max(...truth.map((t) => {
      const near = pts.filter((p) => Math.abs(p.mz - t.mz) < 0.05);
      const hi = near.reduce((a, b) => (b.intensity > a.intensity ? b : a));
      return Math.abs(ppm(hi.mz, t.mz));
    }));
    expect(worstApex).toBeGreaterThan(0.2);
  });

  it('keeps one peak per peak where the sampling is coarse, at high m/z', () => {
    const high = [{ mz: 1800.9, intensity: 1e5 }, { mz: 1801.4, intensity: 8e4 }];
    expect(centroid(profile(high))).toHaveLength(2);
  });

  it('keeps a shoulder as its own peak', () => {
    // two peaks just over one peak width apart, so the profile dips only a little between them
    const fwhm = 623.09 / (60000 * Math.sqrt(200 / 623.09));
    const sigma = fwhm / 2.3548;
    const a = { mz: 623.08, intensity: 2.3e5 };
    const b = { mz: 623.08 + 1.1 * fwhm, intensity: 1.6e5 };
    const g = (p: Point, mz: number) => p.intensity * Math.exp(-((mz - p.mz) ** 2) / (2 * sigma * sigma));
    const pts: Point[] = [];
    for (let mz = 623.04; mz < 623.14; mz += fwhm / 3.2) pts.push({ mz, intensity: g(a, mz) + g(b, mz) });
    const valley = Math.min(...pts.filter((p) => p.mz > a.mz && p.mz < b.mz).map((p) => p.intensity));
    expect(valley / b.intensity).toBeGreaterThan(0.8); // a shallow dip, the case that needs care
    const got = centroid(pts);
    expect(got).toHaveLength(2);
    // overlap pulls the smaller peak towards the larger one: here by -6.9 ppm. OpenMS's
    // PeakPickerHiRes (3.6.0) is pulled the same way on these exact points, by -4.2 ppm, so this is a
    // limit of reading peak tops from overlapping peaks, which is measured here rather than hidden
    expect(Math.abs(ppm(got[0].mz, a.mz))).toBeLessThan(2);
    expect(Math.abs(ppm(got[1].mz, b.mz))).toBeLessThan(8);
  });

  it('recognises profile data, and leaves a peak list alone', () => {
    expect(looksLikeProfile(profile(truth))).toBe(true);
    const list = truth.map((t) => ({ ...t }));
    expect(looksLikeProfile(list)).toBe(false);
    const made = toPeakList(list);
    expect(made.converted).toBeNull();
    expect(made.peaks).toEqual(list);
    const conv = toPeakList(profile(truth));
    expect(conv.converted).toEqual({ points: profile(truth).length, peaks: truth.length });
  });

  it('leaves zero-intensity rows out of a peak list', () => {
    const made = toPeakList([...truth, { mz: 400, intensity: 0 }]);
    expect(made.converted).toBeNull();
    expect(made.peaks).toHaveLength(truth.length);
    expect(made.dropped).toBe(1);
  });

  it.skipIf(!existsSync(DATA))('leaves every peak list already in RiPPository alone', () => {
    for (const f of readdirSync(DATA).filter((x) => x.endsWith('.txt'))) {
      const lines = readFileSync(join(DATA, f), 'utf-8').split('\n');
      const at = lines.findIndex((l) => l.startsWith('PK$PEAK:'));
      const peaks = lines.slice(at + 1).filter((l) => l.startsWith('  '))
        .map((l) => { const [mz, intensity] = l.trim().split(' ').map(Number); return { mz, intensity }; });
      expect([f, looksLikeProfile(peaks)]).toEqual([f, false]);
    }
  });
});
