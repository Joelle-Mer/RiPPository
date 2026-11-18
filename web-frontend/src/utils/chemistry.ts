const MONOISOTOPIC: Record<string, number> = {
  H: 1.00782503207,
  C: 12.0,
  N: 14.0030740048,
  O: 15.99491461956,
  S: 31.9720710,
  P: 30.97376163,
  F: 18.99840322,
  Cl: 34.96885268,
  Br: 78.9183371,
  I: 126.904473,
  Se: 79.9165196,
  Si: 27.9769265,
};

export function calculateExactMass(formula: string): number | null {
  if (!formula.trim()) return null;
  const regex = /([A-Z][a-z]?)(\d*)/g;
  let mass = 0;
  let valid = false;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(formula)) !== null) {
    if (!match[1]) continue;
    const el = match[1];
    const n = match[2] ? parseInt(match[2]) : 1;
    if (MONOISOTOPIC[el] === undefined) return null;
    mass += MONOISOTOPIC[el] * n;
    valid = true;
  }
  return valid ? parseFloat(mass.toFixed(5)) : null;
}

export function parsePeakList(
  text: string,
): Array<{ mz: number; intensity: number; rel: number }> | null {
  if (!text.trim()) return null;
  const lines = text.trim().split(/\r?\n/);
  const peaks: Array<{ mz: number; intensity: number; rel: number }> = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[\s,;]+/);
    if (parts.length < 2) return null;
    const mz = parseFloat(parts[0]);
    const intensity = parseFloat(parts[1]);
    if (isNaN(mz) || isNaN(intensity)) return null;
    peaks.push({ mz, intensity, rel: 0 });
  }
  if (peaks.length === 0) return null;
  const maxI = Math.max(...peaks.map((p) => p.intensity));
  peaks.forEach((p) => {
    p.rel = Math.round((p.intensity / maxI) * 999);
  });
  return peaks;
}

async function sha256hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// The SPLASH of a mass spectrum, as defined by Wohlgemuth et al. (Nat Biotechnol 34, 1099; 2016),
// ported step for step from the reference implementation (github.com/berlinguyinca/spectra-hash,
// python/splash/splash.py), with every operation in the same order so the floating-point results,
// and so the code, are the same: splash10-<top ions>-<histogram>-<hash of the whole spectrum>.
const SPLASH_EPS = 1.0e-7;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

type Ion = [number, number];

// intensities scaled so the largest is 100, as the reference Spectrum class does on construction
function splashNormalise(ions: Ion[]): Ion[] {
  const max = Math.max(...ions.map(([, i]) => i));
  return ions.map(([mz, i]) => [mz, (i / max) * 100]);
}

function splashHistogram(ions: Ion[], base: number, length: number, binSize: number) {
  const h = new Array<number>(length).fill(0);
  for (const [mz, i] of ions) h[Math.trunc(mz / binSize) % length] += i;
  const max = Math.max(...h);
  return h.map((x) => BASE36[Math.trunc(SPLASH_EPS + ((base - 1) * x) / max)]).join('');
}

function splashTranslateBase(digits: string, from: number, fill: number) {
  let n = parseInt(digits, from);
  let out = '';
  while (n > 0) {
    out = BASE36[n % 36] + out;
    n = Math.floor(n / 36);
  }
  return out.padStart(fill, '0');
}

export async function calculateSplash(
  peaks: { mz: number; intensity: number }[],
): Promise<string> {
  if (!peaks || peaks.length === 0) return '';
  if (!(Math.max(...peaks.map((p) => p.intensity)) > 0)) return '';
  const spectrum = splashNormalise(peaks.map((p) => [p.mz, p.intensity]));

  // block 2: where the ten largest ions (of those at least 10% of the base peak) fall, base 3 to 36
  const basePeak = Math.max(...spectrum.map(([, i]) => i));
  const top = splashNormalise(
    spectrum
      .filter(([, i]) => i + SPLASH_EPS >= 0.1 * basePeak)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 10),
  );
  const prefilter = splashTranslateBase(splashHistogram(top, 3, 10, 5), 3, 4);

  // block 3: intensity summed in 100-Da bins, folded onto ten digits
  const similarity = splashHistogram(spectrum, 10, 10, 100);

  // block 4: the whole spectrum, m/z to six decimals and intensity to whole numbers, hashed
  const encoded = spectrum
    .map(([mz, i]) => [Math.trunc((mz + SPLASH_EPS) * 1e6), Math.trunc((i + SPLASH_EPS) * 1)] as Ion)
    .sort((a, b) => a[0] - b[0] || b[1] - a[1])
    .map(([mz, i]) => `${mz}:${i}`)
    .join(' ');
  const hash = (await sha256hex(encoded)).slice(0, 20);

  return `splash10-${prefilter}-${similarity}-${hash}`;
}
