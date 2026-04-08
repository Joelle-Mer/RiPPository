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
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function calculateSplash(
  peaks: { mz: number; intensity: number }[],
): Promise<string> {
  if (!peaks || peaks.length === 0) return '';

  // Normalize intensities to max 100
  const maxI = Math.max(...peaks.map((p) => p.intensity));
  if (maxI === 0) return '';
  const norm = peaks.map((p) => ({ mz: p.mz, intensity: (p.intensity / maxI) * 100 }));

  // Block 1: top 10 by intensity, then sort by m/z
  const top10 = [...norm]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, 10)
    .sort((a, b) => a.mz - b.mz);
  const block1Str = top10
    .map((p) => `${p.mz.toFixed(6)}:${Math.round(p.intensity)}`)
    .join(' ');
  const block1 = (await sha256hex(block1Str)).slice(0, 10);

  // Block 2: histogram across 10 bins (0-2000 m/z, 200 per bin)
  const bins = new Array(10).fill(0);
  for (const p of norm) {
    const idx = Math.min(Math.floor(p.mz / 200), 9);
    bins[idx] += p.intensity;
  }
  const maxBin = Math.max(...bins);
  const binsNorm = bins.map((b) => (maxBin > 0 ? Math.round((b / maxBin) * 100) : 0));
  const block2 = (await sha256hex(binsNorm.join(''))).slice(0, 10);

  // Block 3: sum stats
  const mzSum = norm.reduce((s, p) => s + Math.round(p.mz * 10000), 0);
  const intSum = norm.reduce((s, p) => s + Math.round(p.intensity * 10000), 0);
  const block3 = (await sha256hex(`${mzSum}-${intSum}`)).slice(0, 10);

  return `splash10-${block1}-${block2}-${block3}`;
}
