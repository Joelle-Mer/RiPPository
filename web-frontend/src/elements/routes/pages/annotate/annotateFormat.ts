import {
  Candidate,
  KnownComparison,
  Neighbour,
  PeakLink,
  PeakPair,
  PrecursorGaps,
  SavedChain,
  StepMatch,
  SelectionStep,
} from './annotateTypes';

const minus = '−';

function signed(value: number, digits = 2) {
  const text = Math.abs(value).toFixed(digits);
  return value < 0 ? minus + text : '+' + text;
}

type ErrorUnit = 'mDa' | 'ppm';

// the error in the unit the user chose; a candidate without a ppm value keeps its mDa one
function errorIn(
  c: { error_mda: number; error_ppm?: number | null },
  unit: ErrorUnit,
): { value: number; unit: ErrorUnit } {
  if (unit === 'ppm' && c.error_ppm !== undefined && c.error_ppm !== null) {
    return { value: c.error_ppm, unit: 'ppm' };
  }
  return { value: c.error_mda, unit: 'mDa' };
}

function formatError(
  c: { error_mda: number; error_ppm?: number | null },
  unit: ErrorUnit,
  digits?: number,
) {
  const e = errorIn(c, unit);
  return `${signed(e.value, digits ?? (e.unit === 'ppm' ? 1 : 2))} ${e.unit}`;
}

function formatMz(mz: number) {
  return mz.toFixed(4);
}

// the precursor joins the peak list at its m/z with no intensity, so every API call can address it
// by index like a peak while the plot draws it apart from the measured peaks
function withPrecursor(peaks: PeakPair[], precursor: number | null) {
  if (precursor === null) {
    return { peaks, precursorIndex: -1 };
  }
  const after = peaks.findIndex((p) => p[0] > precursor);
  const at = after === -1 ? peaks.length : after;
  const merged: PeakPair[] = [
    ...peaks.slice(0, at),
    [precursor, 0],
    ...peaks.slice(at),
  ];
  return { peaks: merged, precursorIndex: at };
}

// the positions in the full list that an intensity filter keeps, as a share of the strongest peak;
// the precursor point is always kept, since it is worked out rather than measured
function keptPeaks(
  peaks: PeakPair[],
  precursorIndex: number,
  minPercent: number | null,
) {
  const strongest = peaks.reduce((top, p) => Math.max(top, p[1]), 0);
  const floor =
    minPercent !== null && minPercent > 0
      ? (strongest * minPercent) / 100
      : -Infinity;
  return peaks.flatMap((p, i) =>
    i === precursorIndex || p[1] >= floor ? [i] : [],
  );
}

// a saved chain with every peak position moved by `at`; null if any peak has no new position
function movedChain(
  chain: SavedChain,
  at: (i: number) => number | undefined,
): SavedChain | null {
  const picks = chain.picks.map(at);
  const marks = chain.marks.map((m) => ({
    ...m,
    from: at(m.from),
    to: at(m.to),
  }));
  if (
    picks.some((p) => p === undefined) ||
    marks.some((m) => m.from === undefined || m.to === undefined)
  ) {
    return null;
  }
  return { ...chain, picks: picks as number[], marks: marks as PeakLink[] };
}

function chargeOf(chargeHint: string | null) {
  const parsed = parseInt(chargeHint ?? '', 10);
  return Number.isNaN(parsed) ? 1 : Math.abs(parsed);
}

// the markers on the plot, for a peak one residue from the precursor under any reading
function precursorNeighbours(result: PrecursorGaps, peaks: PeakPair[]) {
  return result.matches.map(
    (match): Neighbour => ({
      peak: match.peak,
      mz: peaks[match.peak][0],
      intensity: peaks[match.peak][1],
      gap: match.hypotheses[0].distance,
      direction: 'down',
      candidates: match.hypotheses.flatMap((h) => h.candidates),
    }),
  );
}

function precursorLinks(
  result: PrecursorGaps,
  picks: number[],
  precursorIndex: number,
) {
  return result.matches
    .filter((match) => picks.includes(match.peak))
    .map(
      (match): PeakLink => ({
        from: match.peak,
        to: precursorIndex,
        gap: match.hypotheses[0].distance,
        candidates: match.hypotheses.flatMap((h) => h.candidates),
        toPrecursor: true,
      }),
    );
}

const lowEnd = (link: PeakLink) => Math.min(link.from, link.to);
const highEnd = (link: PeakLink) => Math.max(link.from, link.to);

// every mark between the picks is saved, lowest first, each pair once
function chainMarks(links: PeakLink[]) {
  const seen = new Set<string>();
  return [...links]
    .sort((a, b) => lowEnd(a) - lowEnd(b) || highEnd(a) - highEnd(b))
    .filter((link) => {
      const key = lowEnd(link) + '-' + highEnd(link);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

// marks that overlap go on separate rows; touching ends share one
function markLanes(marks: PeakLink[]) {
  const ends: number[] = [];
  const lanes = marks.map((mark) => {
    let lane = ends.findIndex((end) => end <= lowEnd(mark));
    if (lane < 0) {
      lane = ends.length;
      ends.push(0);
    }
    ends[lane] = highEnd(mark);
    return lane;
  });
  return { lanes, count: Math.max(ends.length, 1) };
}

// the comparison with the known compound reads one path in order, so where marks overlap the earliest stand
function chainPath(links: PeakLink[]) {
  const ordered = [...links].sort(
    (a, b) => Math.min(a.from, a.to) - Math.min(b.from, b.to),
  );
  let reached = -Infinity;
  return ordered.filter((link) => {
    const low = Math.min(link.from, link.to);
    if (low < reached) {
      return false;
    }
    reached = Math.max(link.from, link.to);
    return true;
  });
}

// gaps between neighbouring picks that no residue fits, and that no residue mark already spans
function gapOnlyMarks(
  steps: SelectionStep[],
  links: PeakLink[],
  picked: Set<number>,
): PeakLink[] {
  return steps
    .filter(
      (s) =>
        picked.has(s.from) &&
        picked.has(s.to) &&
        s.result.candidates.length === 0 &&
        !links.some((l) => !l.toPrecursor && l.from <= s.from && l.to >= s.to),
    )
    .map((s) => ({
      from: s.from,
      to: s.to,
      gap: s.result.gap,
      candidates: [],
    }));
}

// a gap no residue fits, named by its mass
const gapMassLabel = (gap: number) => `${gap.toFixed(4)} Da`;

function savedSummary(chain: SavedChain, gapMass = false) {
  const residues = chain.marks
    .filter((m) => m.candidates.length > 0 || gapMass)
    .map((m) =>
      m.candidates.length > 0 ? residueList(m.candidates) : gapMassLabel(m.gap),
    );
  return residues.length > 0 ? residues.join(', ') : 'no residue marks';
}

function stepVerdict(step: StepMatch) {
  const name = step.label ?? `${step.mass.toFixed(4)} Da`;
  if (step.kind === 'unit') {
    return `${name} is the unit ${step.unit_label}`;
  }
  if (step.kind === 'inside') {
    const lost = step.lost_on_fusion ? `, ${step.lost_on_fusion} lost` : '';
    return `${name} fits inside ${step.unit_label}${lost}`;
  }
  return `${name} has no match`;
}

function runVerdict(comparison: KnownComparison) {
  if (comparison.contiguous_run === null) {
    return comparison.units_are_residues === true
      ? 'Order not tested, because not every step is a whole unit.'
      : 'Order not tested, because this compound has units that may not be single residues.';
  }
  return comparison.contiguous_run
    ? 'These steps are a contiguous run of the structure.'
    : 'These steps are not a contiguous run of the structure.';
}

// the best reading is a two-residue jump only when no single residue fits
const isJump = (candidates: Candidate[]) => candidates[0]?.double === true;

function residueList(candidates: Candidate[]) {
  return candidates.map((c) => c.label).join(' / ');
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return '';
  }
  let text = String(value);
  // spectrum names come from uploaded files, so a spreadsheet must not run them as formulas
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = "'" + text;
  }
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function toCsv(rows: (string | number | null | undefined)[][]) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function safeFileName(name: string) {
  const cleaned = name.replace(/[^\w.-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'spectrum';
}

type FeedbackKind = 'problem' | 'feature' | 'other';
const feedbackKinds: Record<FeedbackKind, string> = {
  problem: 'Something is wrong',
  feature: 'A feature to add',
  other: 'Something else',
};

// the subject and body of a feedback message, and the two ways to send it; nothing is sent from here
function feedbackLinks(
  kind: FeedbackKind,
  title: string,
  text: string,
  example: string | null,
  email: string,
  repository: string,
) {
  const tag = kind === 'feature' ? 'feature request' : kind;
  // without a title, the start of the message names it
  const firstLine = text.trim().split(/\r?\n/)[0] ?? '';
  const fallback =
    firstLine.length > 60
      ? firstLine.slice(0, 57).trimEnd() + '...'
      : firstLine;
  const subject = `RiPP annotator, ${tag}: ${title.trim() || fallback || feedbackKinds[kind].toLowerCase()}`;
  const body = [
    text.trim(),
    '',
    '---',
    `Kind: ${feedbackKinds[kind]}`,
    'Sent from the RiPP annotator page.',
    example ? `Example loaded: ${example}` : 'No database example loaded.',
  ].join('\n');
  const query = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return {
    subject,
    body,
    mail: email
      ? `mailto:${encodeURIComponent(email).replace('%40', '@')}?${query}`
      : null,
    issue: `${repository}/issues/new?title=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
}

export type { FeedbackKind };

export {
  gapMassLabel,
  gapOnlyMarks,
  chainMarks,
  feedbackKinds,
  feedbackLinks,
  chainPath,
  markLanes,
  chargeOf,
  csvCell,
  errorIn,
  formatError,
  formatMz,
  keptPeaks,
  movedChain,
  precursorLinks,
  precursorNeighbours,
  isJump,
  residueList,
  runVerdict,
  safeFileName,
  savedSummary,
  signed,
  stepVerdict,
  toCsv,
  withPrecursor,
};
export type { ErrorUnit };
