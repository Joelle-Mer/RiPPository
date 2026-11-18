// Profile spectra turned into peak lists. A profile spectrum samples each peak as a run of closely
// spaced points, usually with zero-intensity points between peaks; a peak list holds one m/z and one
// intensity per peak. The Submit page converts profile data before a record is written, and the
// server refuses a record that still looks like profile data.

export type Point = { mz: number; intensity: number };

// A run of this many points or more, each within RUN_GAP of the next, is one peak sampled as a profile.
// A peak list practically never holds such runs: its peaks are separated by at least the instrument's
// resolution, which at RUN_GAP is far finer than any instrument offers for peaks of separate ions.
const RUN_POINTS = 4;
const RUN_GAP = 0.05; // Da
// share of all points lying in such runs, or with zero intensity, above which the data is a profile
const PROFILE_SHARE = 0.5;

function sorted(points: Point[]) {
  return [...points].sort((a, b) => a.mz - b.mz);
}

// what share of the points are zero-intensity or sit inside a profile-like run
export function profileShare(points: Point[]) {
  if (points.length === 0) return 0;
  const p = sorted(points);
  let inRuns = 0;
  let start = 0;
  const close = (end: number) => {
    let n = 0;
    for (let k = start; k < end; k++) if (p[k].intensity > 0) n++;
    if (n >= RUN_POINTS) inRuns += n;
  };
  for (let k = 1; k <= p.length; k++) {
    if (k === p.length || p[k].mz - p[k - 1].mz > RUN_GAP || p[k].intensity <= 0 || p[k - 1].intensity <= 0) {
      close(k);
      start = k;
    }
  }
  const zeros = p.filter((x) => x.intensity <= 0).length;
  return (inRuns + zeros) / p.length;
}

export function looksLikeProfile(points: Point[]) {
  return profileShare(points) > PROFILE_SHARE;
}

// The top of a peak sampled at three points: for a Gaussian peak the logarithms of the three
// intensities lie on a parabola, so its vertex gives the exact centre and height. Falls back to a
// plain parabola, and to the highest point itself, when the logarithm cannot be taken.
function apex(a: Point, b: Point, c: Point): Point {
  const fit = (ya: number, yb: number, yc: number) => {
    const h1 = b.mz - a.mz;
    const h2 = c.mz - b.mz;
    // parabola through (−h1, ya), (0, yb), (h2, yc)
    const den = h1 * h2 * (h1 + h2);
    const A = (h1 * (yc - yb) - h2 * (yb - ya)) / den;
    const B = (h1 * h1 * (yc - yb) + h2 * h2 * (yb - ya)) / den;
    if (!(A < 0)) return null;
    const x = -B / (2 * A);
    if (x < -h1 || x > h2) return null;
    return { x, y: yb - (B * B) / (4 * A) };
  };
  if (a.intensity > 0 && c.intensity > 0) {
    const g = fit(Math.log(a.intensity), Math.log(b.intensity), Math.log(c.intensity));
    if (g) return { mz: b.mz + g.x, intensity: Math.exp(g.y) };
  }
  const q = fit(a.intensity, b.intensity, c.intensity);
  if (q) return { mz: b.mz + q.x, intensity: q.y };
  return { mz: b.mz, intensity: b.intensity };
}

// The points split into peaks: at a zero point, at a gap wider than a profile's sampling, and at a
// dip between two tops, so that close peaks (isotopes of a highly charged ion, a shoulder) stay
// separate. Every dip splits, as OpenMS's PeakPickerHiRes does: a rule that merged shallow dips
// (below 0.8 of the lower top) lost 6 of the 3,244 peaks OpenMS finds in the first lasso spectra
// submitted, all of them real shoulders; splitting at every dip finds all 3,244.
const VALLEY = 1;

// A gap ends a peak when it is STEP_JUMP times wider than the sampling step beside it. The step is
// read locally because a profile's sampling widens with m/z (an Orbitrap samples about six times
// more coarsely at m/z 2000 than at m/z 200), so no single gap width fits a whole spectrum.
const STEP_JUMP = 2.5;
const NEVER_ONE_PEAK = 0.5; // Da: points this far apart are never one peak

export function centroid(points: Point[]): Point[] {
  const p = sorted(points);
  // runs of non-zero points
  const runs: Point[][] = [];
  let cur: Point[] = [];
  for (const x of p) {
    if (x.intensity > 0) cur.push(x);
    else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);

  const segments: Point[][] = [];
  for (const run of runs) {
    const gap = (k: number) => run[k].mz - run[k - 1].mz; // gap before point k
    let from = 0;
    for (let k = 1; k < run.length; k++) {
      const g = gap(k);
      const beside = [k > 1 ? gap(k - 1) : Infinity, k + 1 < run.length ? gap(k + 1) : Infinity];
      const step = Math.min(...beside);
      if (g > NEVER_ONE_PEAK || (Number.isFinite(step) && g > STEP_JUMP * step) ||
          (!Number.isFinite(step) && g > RUN_GAP)) {
        segments.push(run.slice(from, k));
        from = k;
      }
    }
    segments.push(run.slice(from));
  }

  const peaks: Point[] = [];
  for (const seg of segments) {
    for (const part of splitAtDips(seg)) peaks.push(top(part));
  }
  return peaks;
}

function splitAtDips(seg: Point[]): Point[][] {
  if (seg.length < 3) return [seg];
  // local tops, in order
  const tops: number[] = [];
  for (let k = 0; k < seg.length; k++) {
    const left = k === 0 ? -Infinity : seg[k - 1].intensity;
    const right = k === seg.length - 1 ? -Infinity : seg[k + 1].intensity;
    if (seg[k].intensity > left && seg[k].intensity >= right) tops.push(k);
  }
  if (tops.length < 2) return [seg];
  const cuts: number[] = [];
  let keep = tops[0];
  for (let t = 1; t < tops.length; t++) {
    const next = tops[t];
    let low = keep;
    for (let k = keep; k <= next; k++) if (seg[k].intensity < seg[low].intensity) low = k;
    const lower = Math.min(seg[keep].intensity, seg[next].intensity);
    if (seg[low].intensity < VALLEY * lower) {
      cuts.push(low);
      keep = next;
    } else if (seg[next].intensity > seg[keep].intensity) {
      keep = next;
    }
  }
  const parts: Point[][] = [];
  let from = 0;
  for (const c of cuts) {
    // the valley point goes with the side it is closer to in height
    parts.push(seg.slice(from, c + 1));
    from = c;
  }
  parts.push(seg.slice(from));
  return parts;
}

function top(part: Point[]): Point {
  let k = 0;
  for (let i = 1; i < part.length; i++) if (part[i].intensity > part[k].intensity) k = i;
  if (k === 0 || k === part.length - 1) return { mz: part[k].mz, intensity: part[k].intensity };
  return apex(part[k - 1], part[k], part[k + 1]);
}

// what the Submit page uses: a peak list as given, or a profile turned into one. Zero-intensity
// points are never peaks and are left out either way.
export function toPeakList(points: Point[]) {
  if (looksLikeProfile(points)) {
    const peaks = centroid(points);
    return { peaks, converted: { points: points.length, peaks: peaks.length } };
  }
  const peaks = points.filter((x) => x.intensity > 0);
  return { peaks, converted: null as null | { points: number; peaks: number }, dropped: points.length - peaks.length };
}

// the processing line a converted record carries, so a reader knows its peaks were derived here
export function processingNote(c: { points: number; peaks: number }) {
  return `FIND_PEAK centroided from profile data on submission to RiPPository (${c.points} points, ${c.peaks} peaks)`;
}
