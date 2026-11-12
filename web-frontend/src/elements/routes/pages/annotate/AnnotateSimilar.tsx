import { useMemo, useState } from 'react';
import { Alert, Collapse, Spin } from 'antd';
import { scaleLinear } from 'd3';
import { PeakPair, SimilarRecord, SimilarResult } from './annotateTypes';
import { formatMz } from './annotateFormat';

type InputProps = {
  peaks: PeakPair[];
  example: string | null;
  remote: { data: SimilarResult | null; error: string | null };
};

const width = 900;
const height = 340;
const margin = { top: 22, right: 20, bottom: 30, left: 50 };
const colors = {
  peak: '#9ca3af',
  direct: 'rgb(5, 109, 220)',
  shifted: '#c2570c',
  axis: '#1f2937',
};
const font = 'Arial, Helvetica, sans-serif';

function Mirror({
  peaks,
  record,
}: {
  peaks: PeakPair[];
  record: SimilarRecord;
}) {
  const kind = useMemo(() => {
    const query = new Map<number, boolean>();
    const ref = new Map<number, boolean>();
    record.matched_pairs.forEach((p) => {
      query.set(p.query_index, p.shifted);
      ref.set(p.ref_index, p.shifted);
    });
    return { query, ref };
  }, [record]);
  const all = [...peaks, ...record.ref_peaks].map((p) => p[0]);
  const low = Math.min(...all);
  const high = Math.max(...all);
  const pad = Math.max((high - low) * 0.03, 1);
  const x = scaleLinear()
    .domain([low - pad, high + pad])
    .range([margin.left, width - margin.right]);
  const middle = margin.top + (height - margin.top - margin.bottom) / 2;
  const half = middle - margin.top;
  const topBase = Math.max(...peaks.map((p) => p[1]), 1);
  const refBase = Math.max(...record.ref_peaks.map((p) => p[1]), 1);
  const colour = (shifted: boolean | undefined) =>
    shifted === undefined
      ? colors.peak
      : shifted
        ? colors.shifted
        : colors.direct;

  return (
    <svg
      className="annotate-mirror"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Your spectrum above, ${record.name} below, matched peaks coloured`}
    >
      {peaks.map((p, i) => (
        <line
          key={'q' + i}
          x1={x(p[0])}
          x2={x(p[0])}
          y1={middle}
          y2={middle - (p[1] / topBase) * half}
          stroke={colour(kind.query.get(i))}
          strokeWidth={kind.query.has(i) ? 1.8 : 1}
        />
      ))}
      {record.ref_peaks.map((p, i) => (
        <line
          key={'r' + i}
          x1={x(p[0])}
          x2={x(p[0])}
          y1={middle}
          y2={middle + (p[1] / refBase) * half}
          stroke={colour(kind.ref.get(i))}
          strokeWidth={kind.ref.has(i) ? 1.8 : 1}
        />
      ))}
      <line
        x1={margin.left}
        x2={width - margin.right}
        y1={middle}
        y2={middle}
        stroke={colors.axis}
      />
      {x.ticks(8).map((t) => (
        <text
          key={t}
          x={x(t)}
          y={height - 10}
          textAnchor="middle"
          fontSize={11}
          fontFamily={font}
          fill={colors.axis}
        >
          {t}
        </text>
      ))}
      <text
        x={margin.left}
        y={14}
        fontSize={12}
        fontFamily={font}
        fill={colors.axis}
      >
        Your spectrum
      </text>
      <text
        x={margin.left}
        y={height - 30}
        fontSize={12}
        fontFamily={font}
        fill={colors.axis}
      >
        {record.name} · {record.accession}
      </text>
      <text
        x={width - margin.right}
        y={height - 10}
        textAnchor="end"
        fontSize={11}
        fontFamily={font}
        fill={colors.axis}
      >
        m/z
      </text>
    </svg>
  );
}

function SimilarBody({
  peaks,
  example,
  result,
}: InputProps & { result: SimilarResult }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const picked =
    result.results.find((r) => r.accession === chosen) ?? result.results[0];
  if (result.results.length === 0) {
    return (
      <p className="annotate-empty">
        No record in RiPPository shares peaks with this spectrum.
      </p>
    );
  }
  return (
    <>
      <p className="annotate-hint">
        The closest of {result.n_scored} records in RiPPository, from the
        site&apos;s spectral search ({result.method}, peaks matched within{' '}
        {picked.tolerance} Da
        {result.method === 'modified cosine'
          ? ', directly or shifted by the difference between the two precursors'
          : ''}
        ). Read it as an order, not as an identification: a high score does not
        mean the same compound.
      </p>
      <div className="annotate-table-wrap">
        <table className="annotate-table annotate-similar-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Compound</th>
              <th>Record</th>
              <th>Score</th>
              <th>Matched peaks</th>
              <th>Precursor</th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r, n) => (
              <tr
                key={r.accession}
                className={
                  r.accession === picked.accession
                    ? 'annotate-similar-picked'
                    : undefined
                }
                onClick={() => setChosen(r.accession)}
              >
                <td>{n + 1}</td>
                <td>
                  {r.name}
                  {r.accession === example ? ' (this record)' : ''}
                </td>
                <td>{r.accession}</td>
                <td>{r.score.toFixed(3)}</td>
                <td>
                  {r.n_matched} of your {r.n_query_peaks}
                  {r.n_matched_shifted > 0
                    ? ` (${r.n_matched_shifted} shifted)`
                    : ''}
                </td>
                <td>
                  {r.ref_precursor !== null ? formatMz(r.ref_precursor) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="annotate-hint">
        Click a row to compare it below.{' '}
        <span style={{ color: colors.direct }}>Blue</span> peaks match directly
        {picked.precursor_shift !== null ? (
          <>
            , <span style={{ color: colors.shifted }}>orange</span> ones match
            after shifting by the precursor difference (
            {picked.precursor_shift.toFixed(4)} Da)
          </>
        ) : null}
        , grey ones are unmatched.
      </p>
      <Mirror peaks={peaks} record={picked} />
    </>
  );
}

function AnnotateSimilar({ peaks, example, remote }: InputProps) {
  return (
    <Collapse
      className="annotate-known"
      items={[
        {
          key: 'similar',
          label: 'Closest spectra in RiPPository',
          children: remote.error ? (
            <Alert type="error" title={remote.error} showIcon />
          ) : remote.data ? (
            <SimilarBody
              peaks={peaks}
              example={example}
              remote={remote}
              result={remote.data}
            />
          ) : (
            <Spin size="small" />
          ),
        },
      ]}
    />
  );
}

export default AnnotateSimilar;
