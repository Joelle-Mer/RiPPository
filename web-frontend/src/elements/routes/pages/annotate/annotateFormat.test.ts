import { describe, expect, it } from 'vitest';
import {
  gapMassLabel,
  gapOnlyMarks,
  chainMarks,
  feedbackLinks,
  chainPath,
  markLanes,
  chargeOf,
  csvCell,
  errorIn,
  formatError,
  keptPeaks,
  movedChain,
  precursorLinks,
  precursorNeighbours,
  runVerdict,
  safeFileName,
  savedSummary,
  signed,
  stepVerdict,
  withPrecursor,
} from './annotateFormat';
import { PeakPair } from './annotateTypes';

describe('withPrecursor', () => {
  const peaks: PeakPair[] = [
    [100, 5],
    [200, 5],
    [300, 5],
  ];

  it('keeps the list in m/z order and reports where the precursor went', () => {
    const merged = withPrecursor(peaks, 250);
    expect(merged.peaks.map((p) => p[0])).toEqual([100, 200, 250, 300]);
    expect(merged.precursorIndex).toBe(2);
    expect(merged.peaks[2][1]).toBe(0);
  });

  it('puts a precursor above every fragment last', () => {
    expect(withPrecursor(peaks, 900).precursorIndex).toBe(3);
  });

  it('leaves the list alone when no precursor is known', () => {
    const merged = withPrecursor(peaks, null);
    expect(merged.peaks).toBe(peaks);
    expect(merged.precursorIndex).toBe(-1);
  });
});

describe('precursor readings', () => {
  const gly = { label: 'Gly', mass: 57, error_mda: 1, error_ppm: 20 };
  const far = { label: 'Ala', mass: 71, error_mda: 9, error_ppm: 120 };
  const reading = (c: typeof gly) => ({
    hypothesis: 'cyclic',
    offset: 0,
    why: '',
    distance: 57,
    candidates: [c],
  });
  const result = {
    precursor: { precursor_mz: 300, charge: 1, neutral: 299, mh1: 300 },
    matches: [
      { peak: 0, hypotheses: [reading(gly)] },
      { peak: 1, hypotheses: [reading(far)] },
    ],
  };

  it('reads the precursor charge, assuming 1+ when the file does not say', () => {
    expect(chargeOf('2+')).toBe(2);
    expect(chargeOf(null)).toBe(1);
    expect(chargeOf('n/a')).toBe(1);
  });

  it('turns matches into plot markers and marks only picked peaks', () => {
    const peaks: PeakPair[] = [
      [100, 5],
      [200, 5],
      [300, 0],
    ];
    expect(precursorNeighbours(result, peaks).map((n) => n.peak)).toEqual([
      0, 1,
    ]);
    const links = precursorLinks(result, [1], 2);
    expect(links).toHaveLength(1);
    expect(links[0].toPrecursor).toBe(true);
    expect(links[0].to).toBe(2);
  });
});

describe('saved chains', () => {
  const gly = { label: 'Gly', mass: 57, error_mda: 1 };
  const link = (from: number, to: number) => ({
    from,
    to,
    gap: 57,
    candidates: [gly],
  });

  it('saves every mark, overlapping or not, lowest first', () => {
    const kept = chainMarks([link(5, 9), link(1, 3), link(3, 5), link(1, 9)]);
    expect(kept.map((m) => [m.from, m.to])).toEqual([
      [1, 3],
      [1, 9],
      [3, 5],
      [5, 9],
    ]);
  });

  it('keeps two marks that start from the same peak', () => {
    // two neighbours added from one anchor: the case that used to keep only one
    const kept = chainMarks([link(4, 6), link(4, 8)]);
    expect(kept).toHaveLength(2);
  });

  it('saves a pair once', () => {
    expect(chainMarks([link(3, 5), link(5, 3)])).toHaveLength(1);
  });

  it('puts overlapping marks on separate rows and touching ones on one', () => {
    const marks = chainMarks([link(5, 9), link(1, 3), link(3, 5), link(1, 9)]);
    const { lanes, count } = markLanes(marks);
    expect(lanes).toEqual([0, 1, 0, 0]);
    expect(count).toBe(2);
    expect(markLanes([]).count).toBe(1);
  });

  it('compares one path with the known compound', () => {
    const path = chainPath([link(5, 9), link(1, 3), link(3, 5), link(1, 9)]);
    expect(path.map((m) => [m.from, m.to])).toEqual([
      [1, 3],
      [3, 5],
      [5, 9],
    ]);
  });

  it('handles a mark to a precursor that sits below the fragment', () => {
    const kept = chainMarks([{ ...link(9, 2), toPrecursor: true }]);
    expect(kept).toHaveLength(1);
    expect(markLanes(kept).lanes).toEqual([0]);
  });

  it('words each kind of match without claiming more', () => {
    const step = { label: 'Cys', mass: 103 };
    expect(
      stepVerdict({
        ...step,
        kind: 'inside',
        unit_label: 'Leu-Thn',
        lost_on_fusion: 'H2O',
      }),
    ).toBe('Cys fits inside Leu-Thn, H2O lost');
    expect(stepVerdict({ ...step, kind: 'unit', unit_label: 'Cys' })).toBe(
      'Cys is the unit Cys',
    );
    expect(stepVerdict({ ...step, kind: 'no match' })).toBe('Cys has no match');
    expect(stepVerdict({ label: null, mass: 103, kind: 'no match' })).toBe(
      '103.0000 Da has no match',
    );
  });

  it('only claims an order when the API tested one', () => {
    const base = { n_steps: 2, steps: [] };
    const run = (contiguous: boolean | null, units: boolean | null) =>
      runVerdict({
        ...base,
        contiguous_run: contiguous,
        units_are_residues: units,
      });
    expect(run(true, true)).toContain('are a contiguous run');
    expect(run(false, true)).toContain('not a contiguous run');
    expect(run(null, true)).toContain('Order not tested');
    expect(run(null, null)).toContain('may not be single residues');
  });

  it('summarises a chain, or says it has no marks', () => {
    const chain = { id: 1, color: '#000', charge: 1, picks: [1, 3] };
    expect(savedSummary({ ...chain, marks: [link(1, 3)] })).toBe('Gly');
    expect(savedSummary({ ...chain, marks: [] })).toBe('no residue marks');
  });
});

describe('export helpers', () => {
  it('stops a spectrum name running as a spreadsheet formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });

  it('leaves negative numbers as numbers', () => {
    expect(csvCell(-0.9)).toBe('-0.9');
  });

  it('quotes commas', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });

  it('makes a safe file name', () => {
    expect(safeFileName('../../Lasso 1795')).toBe('Lasso_1795');
    expect(safeFileName('///')).toBe('spectrum');
  });

  it('shows the sign of an error', () => {
    expect(signed(-0.9)).toBe('−0.90');
    expect(signed(0.5)).toBe('+0.50');
  });

  it('shows an error with its unit, in the unit chosen', () => {
    const c = { error_mda: -0.34, error_ppm: 2.6 };
    expect(formatError(c, 'mDa')).toBe('−0.34 mDa');
    expect(formatError(c, 'ppm')).toBe('+2.6 ppm');
    expect(formatError(c, 'mDa', 1)).toBe('−0.3 mDa');
  });

  it('keeps mDa when a result has no ppm value, rather than inventing one', () => {
    const c = { error_mda: 0.8 };
    expect(errorIn(c, 'ppm')).toEqual({ value: 0.8, unit: 'mDa' });
    expect(formatError(c, 'ppm')).toBe('+0.80 mDa');
  });

  it('keeps peaks at or above the filter, and always the precursor point', () => {
    const peaks: PeakPair[] = [
      [100, 5],
      [150, 50],
      [200, 0],
      [250, 100],
      [300, 9.99],
    ];
    expect(keptPeaks(peaks, 2, null)).toEqual([0, 1, 2, 3, 4]);
    expect(keptPeaks(peaks, 2, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(keptPeaks(peaks, 2, 10)).toEqual([1, 2, 3]);
    expect(keptPeaks(peaks, -1, 10)).toEqual([1, 3]);
    expect(keptPeaks(peaks, -1, 50)).toEqual([1, 3]);
  });

  it('moves a saved chain to new peak positions, or hides it when a peak is gone', () => {
    const chain = {
      id: 1,
      color: '#000',
      charge: 1,
      picks: [1, 3],
      marks: [{ from: 1, to: 3, gap: 57.02, candidates: [] }],
    };
    const toView = new Map([
      [1, 0],
      [3, 1],
    ]);
    expect(movedChain(chain, (i) => toView.get(i))).toEqual({
      ...chain,
      picks: [0, 1],
      marks: [{ from: 0, to: 1, gap: 57.02, candidates: [] }],
    });
    expect(movedChain(chain, (i) => (i === 1 ? 0 : undefined))).toBeNull();
  });
});

describe('feedback links', () => {
  const repo = 'https://github.com/owner/repo';

  it('offers email only when an address is set', () => {
    expect(feedbackLinks('problem', '', 'x', null, '', repo).mail).toBeNull();
    expect(
      feedbackLinks('problem', '', 'x', null, 'a@b.org', repo).mail,
    ).toMatch(/^mailto:a@b\.org\?subject=/);
  });

  it('carries the text and kind exactly, through both links', () => {
    const text = 'Gap at 214 & 271?\nSecond line, ünïcode #1';
    const links = feedbackLinks(
      'feature',
      'More sets',
      text,
      'MSBNK-1',
      'a@b.org',
      repo,
    );
    const mail = new URLSearchParams(links.mail!.split('?')[1]);
    const issue = new URL(links.issue);
    expect(issue.origin + issue.pathname).toBe(repo + '/issues/new');
    expect(mail.get('subject')).toBe(
      'RiPP annotator, feature request: More sets',
    );
    expect(issue.searchParams.get('title')).toBe(mail.get('subject'));
    expect(mail.get('body')!.startsWith(text + '\n')).toBe(true);
    expect(issue.searchParams.get('body')).toBe(mail.get('body'));
    expect(mail.get('body')).toContain('Example loaded: MSBNK-1');
  });

  it('names it from the start of the message when there is no title', () => {
    expect(feedbackLinks('problem', '  ', 'x', null, '', repo).subject).toBe(
      'RiPP annotator, problem: x',
    );
    const long = 'a'.repeat(80) + '\nsecond line';
    const subject = feedbackLinks('other', '', long, null, '', repo).subject;
    expect(subject).toBe('RiPP annotator, other: ' + 'a'.repeat(57) + '...');
    expect(feedbackLinks('other', '', '', null, '', repo).subject).toBe(
      'RiPP annotator, other: something else',
    );
  });
});

describe('gaps no residue fits', () => {
  const gly = { label: 'Gly', mass: 57.02146, error_mda: 0.1 };
  const step = (from: number, to: number, gap: number, fits: boolean) => ({
    from,
    to,
    result: { gap, tol: 0.01, charge: 1, candidates: fits ? [gly] : [] },
  });

  it('keeps only unexplained gaps between picks that no residue mark spans', () => {
    const steps = [
      step(1, 2, 57.02, true),
      step(2, 3, 123.4567, false),
      step(3, 4, 99.9, false),
    ];
    const links = [{ from: 3, to: 5, gap: 1, candidates: [gly] }];
    const marks = gapOnlyMarks(steps as never, links, new Set([1, 2, 3, 4]));
    // 1-2 fits a residue; 3-4 is spanned by the 3-5 mark; only 2-3 is left
    expect(marks).toEqual([{ from: 2, to: 3, gap: 123.4567, candidates: [] }]);
    expect(gapOnlyMarks(steps as never, [], new Set([1, 2]))).toEqual([]);
  });

  it('names a gap by its mass only while the switch is on', () => {
    const chain = {
      id: 1,
      color: '#000',
      charge: 1,
      picks: [1, 2, 3],
      marks: [
        { from: 1, to: 2, gap: 57.02, candidates: [gly] },
        { from: 2, to: 3, gap: 123.4567, candidates: [] },
      ],
    };
    expect(savedSummary(chain)).toBe('Gly');
    expect(savedSummary(chain, true)).toBe('Gly, 123.4567 Da');
    expect(gapMassLabel(123.45671)).toBe('123.4567 Da');
  });
});
