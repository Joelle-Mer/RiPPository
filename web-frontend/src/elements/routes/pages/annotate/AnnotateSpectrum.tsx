import {
  KeyboardEvent,
  PointerEvent,
  RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { scaleLinear } from 'd3';
import { Button } from 'antd';
import {
  Candidate,
  Neighbour,
  PeakLink,
  PeakPair,
  SavedChain,
  SelectionStep,
} from './annotateTypes';
import {
  formatError,
  formatMz,
  gapMassLabel,
  gapOnlyMarks,
  markLanes,
  residueList,
} from './annotateFormat';
import { useErrorUnit } from './annotateUnit';

const height = 360;
const margin = { top: 84, right: 24, bottom: 44, left: 56 };
const hitPixels = 8;
const dragPixels = 5;
const minSpan = 0.5;
const keyStride = 10;
const wheelStep = 0.8;
const minTop = 0.05;
const labelLift = 20;
const markRows = [16, 38, 60];
const savedRow = 24;
const colors = {
  peak: '#8a94a6',
  picked: 'rgb(5, 109, 220)',
  neighbour: '#c2570c',
  highlight: '#0f766e',
  unmatched: '#6b7280',
  precursor: '#7c3aed',
  axis: '#1f2937',
};
const font = 'Arial, Helvetica, sans-serif';

type LabelTarget = {
  peak: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

type InputProps = {
  peaks: PeakPair[];
  picks: number[];
  anchor: number | null;
  precursor: number;
  neighbours: Neighbour[];
  steps: SelectionStep[];
  links: PeakLink[];
  saved: SavedChain[];
  highlight: number[];
  svgRef: RefObject<SVGSVGElement | null>;
  onTogglePeak: (peak: number) => void;
  // peaks caught by a right-button box, lowest m/z first
  onAddPeaks: (peaks: number[]) => void;
  // shown beside Reset zoom while there is a chain to save
  onSaveChain: (() => void) | null;
  // label a gap no residue fits with its mass, instead of "no single residue"
  gapMass: boolean;
  onRemoveSaved: (id: number) => void;
};

function AnnotateSpectrum({
  peaks,
  picks,
  anchor,
  precursor,
  neighbours,
  steps,
  links,
  saved,
  highlight,
  svgRef,
  onTogglePeak,
  onAddPeaks,
  onSaveChain,
  gapMass,
  onRemoveSaved,
}: InputProps) {
  const errorUnit = useErrorUnit();
  const frameRef = useRef<HTMLDivElement>(null);
  const xAxisRef = useRef<SVGRectElement>(null);
  const yAxisRef = useRef<SVGRectElement>(null);
  const [width, setWidth] = useState(900);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [yTop, setYTop] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  // left button: drag across m/z to zoom; right button: draw a box to pick the peaks whose tops are in it
  const [drag, setDrag] = useState<{
    start: number;
    now: number;
    select: boolean;
    startY: number;
    nowY: number;
  } | null>(null);

  useEffect(() => {
    if (!frameRef.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(320, Math.round(entry.contentRect.width))),
    );
    observer.observe(frameRef.current);
    return () => observer.disconnect();
  }, []);

  const fullRange = useMemo((): [number, number] => {
    const first = peaks[0][0];
    const last = peaks[peaks.length - 1][0];
    const pad = Math.max((last - first) * 0.03, 1);
    return [first - pad, last + pad];
  }, [peaks]);

  const domain = zoom ?? fullRange;
  const xScale = useMemo(
    () =>
      scaleLinear()
        .domain(domain)
        .range([margin.left, width - margin.right]),
    [domain, width],
  );

  // indices stay those of the full list: the API addresses peaks by them, so hiding peaks that are
  // outside the zoom must not renumber anything
  const visible = useMemo(() => {
    const shown: number[] = [];
    peaks.forEach((p, i) => {
      if (p[0] >= domain[0] && p[0] <= domain[1]) {
        shown.push(i);
      }
    });
    return shown;
  }, [domain, peaks]);

  const basePeak = useMemo(() => Math.max(...peaks.map((p) => p[1])), [peaks]);
  const fittedTop = useMemo(() => {
    const top = Math.max(1e-9, ...visible.map((i) => peaks[i][1]));
    return scaleLinear()
      .domain([0, (top / basePeak) * 100])
      .nice()
      .domain()[1];
  }, [basePeak, peaks, visible]);
  // a chosen y top may sit below the tallest peaks, so those sticks stop at the top of the plot
  const yScale = useMemo(
    () =>
      scaleLinear()
        .domain([0, yTop ?? fittedTop])
        .range([height - margin.bottom, margin.top])
        .clamp(true),
    [fittedTop, yTop],
  );

  // pulling an axis: drag right on m/z or up on intensity to zoom in, the other way to zoom out
  const axisDrag = useRef<{
    axis: 'x' | 'y';
    start: number;
    domain: [number, number];
    top: number;
    share: number;
  } | null>(null);
  const pullStart =
    (axis: 'x' | 'y') => (event: PointerEvent<SVGRectElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const box = event.currentTarget.getBoundingClientRect();
      axisDrag.current = {
        axis,
        start: axis === 'x' ? event.clientX : event.clientY,
        domain: [domain[0], domain[1]],
        top: yTop ?? fittedTop,
        share: Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1),
      };
    };
  const pullMove = (event: PointerEvent<SVGRectElement>) => {
    const drag = axisDrag.current;
    if (!drag) {
      return;
    }
    if (drag.axis === 'x') {
      const [low, high] = drag.domain;
      const span = Math.max(
        (high - low) * Math.exp(-(event.clientX - drag.start) / 150),
        minSpan,
      );
      if (span >= fullRange[1] - fullRange[0]) {
        setZoom(null);
        return;
      }
      // the m/z under the pointer when the drag began stays under it
      const anchor = low + (high - low) * drag.share;
      const start = Math.min(
        Math.max(anchor - span * drag.share, fullRange[0]),
        fullRange[1] - span,
      );
      setZoom([start, start + span]);
    } else {
      const next = Math.max(
        drag.top * Math.exp((event.clientY - drag.start) / 150),
        minTop,
      );
      setYTop(next >= fittedTop ? null : next);
    }
  };
  const pullEnd = () => {
    axisDrag.current = null;
  };

  // React's own wheel handler is passive and cannot stop the page scrolling, so these are native
  useEffect(() => {
    const xAxis = xAxisRef.current;
    const yAxis = yAxisRef.current;
    if (!xAxis || !yAxis) {
      return;
    }
    const zoomX = (event: WheelEvent) => {
      event.preventDefault();
      const [low, high] = domain;
      const factor = event.deltaY < 0 ? wheelStep : 1 / wheelStep;
      const span = Math.max((high - low) * factor, minSpan);
      if (span >= fullRange[1] - fullRange[0]) {
        setZoom(null);
        return;
      }
      const box = xAxis.getBoundingClientRect();
      const share = Math.min(
        Math.max((event.clientX - box.left) / box.width, 0),
        1,
      );
      const start = low + (high - low) * share - span * share;
      const kept = Math.min(Math.max(start, fullRange[0]), fullRange[1] - span);
      setZoom([kept, kept + span]);
    };
    const zoomY = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? wheelStep : 1 / wheelStep;
      const next = Math.max((yTop ?? fittedTop) * factor, minTop);
      setYTop(next >= fittedTop ? null : next);
    };
    xAxis.addEventListener('wheel', zoomX, { passive: false });
    yAxis.addEventListener('wheel', zoomY, { passive: false });
    return () => {
      xAxis.removeEventListener('wheel', zoomX);
      yAxis.removeEventListener('wheel', zoomY);
    };
  }, [domain, fittedTop, fullRange, yTop]);

  // the precursor has no measured intensity here, so it is drawn the full height of the plot
  const y = (i: number) =>
    i === precursor ? margin.top : yScale((peaks[i][1] / basePeak) * 100);
  const describe = (i: number) =>
    i === precursor
      ? `Precursor m/z ${formatMz(peaks[i][0])}`
      : `m/z ${formatMz(peaks[i][0])} · ${((peaks[i][1] / basePeak) * 100).toFixed(1)}%`;
  const pickedSet = useMemo(() => new Set(picks), [picks]);
  const highlightSet = useMemo(() => new Set(highlight), [highlight]);
  const neighbourMap = useMemo(
    () => new Map(neighbours.map((n) => [n.peak, n])),
    [neighbours],
  );

  // the first saved chain to use a peak gives it its colour
  const savedColor = useMemo(() => {
    const colours = new Map<number, string>();
    saved.forEach((chain) =>
      chain.picks.forEach((peak) => {
        if (!colours.has(peak)) {
          colours.set(peak, chain.color);
        }
      }),
    );
    return colours;
  }, [saved]);

  const nearestPeak = (x: number) => {
    let best: number | null = null;
    let bestDistance = hitPixels + 1;
    for (const i of visible) {
      const distance = Math.abs(xScale(peaks[i][0]) - x);
      const closer = distance < bestDistance - 0.5;
      const tied = Math.abs(distance - bestDistance) <= 0.5;
      if (closer || (tied && best !== null && peaks[i][1] > peaks[best][1])) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  };

  const pointerX = (event: PointerEvent<SVGRectElement>) =>
    event.clientX -
    event.currentTarget.getBoundingClientRect().left +
    margin.left;

  // the hit area starts at the top of the plot group, so this is already in plot coordinates
  const pointerY = (event: PointerEvent<SVGRectElement>) =>
    event.clientY - event.currentTarget.getBoundingClientRect().top;

  const handlePointerDown = (event: PointerEvent<SVGRectElement>) => {
    if (event.button !== 0 && event.button !== 2) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const x = pointerX(event);
    const yy = pointerY(event);
    setDrag({
      start: x,
      now: x,
      select: event.button === 2,
      startY: yy,
      nowY: yy,
    });
  };

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const x = pointerX(event);
    if (drag) {
      setDrag({ ...drag, now: x, nowY: pointerY(event) });
    } else {
      setHover(nearestPeak(x));
    }
  };

  const handlePointerUp = (event: PointerEvent<SVGRectElement>) => {
    if (!drag) {
      return;
    }
    const x = pointerX(event);
    const yy = pointerY(event);
    setDrag(null);
    if (drag.select) {
      const [left, right] = [Math.min(x, drag.start), Math.max(x, drag.start)];
      const [top, bottom] = [
        Math.min(yy, drag.startY),
        Math.max(yy, drag.startY),
      ];
      if (right - left <= dragPixels && bottom - top <= dragPixels) {
        return;
      }
      // a peak is in the box when its top is: both its m/z and its height
      const caught = visible.filter((i) => {
        const px = xScale(peaks[i][0]);
        const py = y(i);
        return px >= left && px <= right && py >= top && py <= bottom;
      });
      if (caught.length > 0) {
        onAddPeaks(caught);
      }
      return;
    }
    if (Math.abs(x - drag.start) > dragPixels) {
      const low = xScale.invert(Math.min(x, drag.start));
      const high = xScale.invert(Math.max(x, drag.start));
      if (high - low >= minSpan) {
        setZoom([low, high]);
      }
      return;
    }
    const peak = nearestPeak(x);
    if (peak !== null) {
      onTogglePeak(peak);
    }
  };

  // the arrow keys walk the visible peaks through the same hover state a pointer uses
  const handleKeyDown = (event: KeyboardEvent<SVGRectElement>) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const stride = event.shiftKey ? keyStride : 1;
      const at = hover === null ? -1 : visible.indexOf(hover);
      const target =
        at === -1
          ? direction === 1
            ? 0
            : visible.length - 1
          : at + direction * stride;
      const clamped = Math.min(Math.max(target, 0), visible.length - 1);
      setHover(visible[clamped] ?? null);
    } else if ((event.key === 'Enter' || event.key === ' ') && hover !== null) {
      event.preventDefault();
      onTogglePeak(hover);
    }
  };

  const savedDots = visible
    .filter((i) => savedColor.has(i) && !pickedSet.has(i))
    .map((i) => (
      <circle
        key={'saved-dot-' + i}
        cx={xScale(peaks[i][0])}
        cy={y(i)}
        r={3}
        fill={savedColor.get(i)}
      />
    ));

  const sticks = visible.map((i) => {
    const picked = pickedSet.has(i);
    const lit = highlightSet.has(i);
    const near = neighbourMap.has(i);
    const isPrecursor = i === precursor;
    const stroke = picked
      ? colors.picked
      : lit
        ? colors.highlight
        : near
          ? colors.neighbour
          : (savedColor.get(i) ??
            (isPrecursor ? colors.precursor : colors.peak));
    return (
      <line
        key={'stick-' + i}
        x1={xScale(peaks[i][0])}
        x2={xScale(peaks[i][0])}
        y1={yScale(0)}
        y2={y(i)}
        stroke={stroke}
        strokeWidth={
          picked || lit || near || isPrecursor || savedColor.has(i) ? 2.2 : 1.2
        }
        strokeDasharray={isPrecursor ? '6 4' : undefined}
      />
    );
  });

  // a label is drawn only where it fits; the table beside the plot always lists every neighbour.
  // The peak under the pointer or the arrow keys is placed first, so its name always shows and
  // a crowded neighbour gives way to it
  const { neighbourMarks, neighbourTargets } = useMemo(() => {
    const placed: number[] = [];
    const targets: LabelTarget[] = [];
    const marks = visible
      .filter((i) => neighbourMap.has(i) && !pickedSet.has(i))
      .sort(
        (a, b) =>
          Number(b === hover) - Number(a === hover) ||
          peaks[b][1] - peaks[a][1],
      )
      .map((i) => {
        const x = xScale(peaks[i][0]);
        const top =
          i === precursor ? margin.top : yScale((peaks[i][1] / basePeak) * 100);
        const fits = placed.every((other) => Math.abs(other - x) > 15);
        if (fits) {
          placed.push(x);
        }
        const label = neighbourMap.get(i)?.candidates[0].label ?? '';
        const reach = fits ? labelLift + label.length * 6.6 + 4 : 11;
        targets.push({
          peak: i,
          x: x - 7,
          y: top - reach,
          width: 14,
          height: reach,
        });
        return (
          <g key={'mark-' + i}>
            <path
              d={`M ${x - 4} ${top - 9} L ${x + 4} ${top - 9} L ${x} ${top - 2} Z`}
              fill={colors.neighbour}
            />
            {fits && (
              <text
                transform={`translate(${x + 4}, ${top - labelLift}) rotate(-90)`}
                fontSize={12}
                fontFamily={font}
                fontWeight={i === hover ? 'bold' : undefined}
                fill={colors.neighbour}
              >
                {label}
              </text>
            )}
          </g>
        );
      });
    return { neighbourMarks: marks, neighbourTargets: targets };
  }, [
    basePeak,
    hover,
    neighbourMap,
    peaks,
    pickedSet,
    precursor,
    visible,
    xScale,
    yScale,
  ]);

  const pickMarks = picks
    .filter((i) => peaks[i][0] >= domain[0] && peaks[i][0] <= domain[1])
    .map((i) => {
      const x = xScale(peaks[i][0]);
      return (
        <g key={'pick-' + i}>
          <circle
            cx={x}
            cy={y(i)}
            r={i === anchor ? 5 : 3.5}
            fill={colors.picked}
          />
          <text
            transform={`translate(${x - 6}, ${y(i) - 8}) rotate(-90)`}
            fontSize={11}
            fontFamily={font}
            fill={colors.picked}
          >
            {formatMz(peaks[i][0])}
          </text>
        </g>
      );
    });

  // a click on a name means that peak, so names sit above the nearest-peak click layer
  const labelTargets: LabelTarget[] = [
    ...neighbourTargets,
    ...picks
      .filter((i) => peaks[i][0] >= domain[0] && peaks[i][0] <= domain[1])
      .map((i) => ({
        peak: i,
        x: xScale(peaks[i][0]) - 17,
        y: y(i) - 54,
        width: 14,
        height: 46,
      })),
  ];

  // every pair that fits a residue keeps its mark, however many peaks are picked between them. A
  // dashed mark is only for neighbouring picks that nothing else already spans
  const spans = [
    ...links
      .filter((l) => pickedSet.has(l.from) && pickedSet.has(l.to))
      .map((l) => ({
        from: l.from,
        to: l.to,
        gap: l.gap,
        candidates: l.candidates,
        toPrecursor: l.toPrecursor ?? false,
      })),
    ...gapOnlyMarks(steps, links, pickedSet).map((s) => ({
      ...s,
      candidates: [] as Candidate[],
      toPrecursor: false,
    })),
  ].sort(
    (a, b) =>
      Math.min(a.from, a.to) - Math.min(b.from, b.to) ||
      Math.max(a.from, a.to) - Math.max(b.from, b.to),
  );

  const rowEnds = markRows.map(() => -Infinity);
  const brackets = spans.map((span) => {
    // a 2+ precursor can sit below the fragment it is measured from
    const ends = [xScale(peaks[span.from][0]), xScale(peaks[span.to][0])];
    const left = Math.max(Math.min(...ends), margin.left);
    const right = Math.min(Math.max(...ends), width - margin.right);
    if (right <= left) {
      return null;
    }
    const free = rowEnds.findIndex((end) => end + 3 <= left);
    const row = free >= 0 ? free : rowEnds.indexOf(Math.min(...rowEnds));
    rowEnds[row] = right;
    const level = markRows[row];
    const matched = span.candidates.length > 0;
    const color = span.toPrecursor
      ? colors.precursor
      : matched
        ? colors.picked
        : colors.unmatched;
    const label = matched
      ? `${residueList(span.candidates)} ${formatError(span.candidates[0], errorUnit, 1)}`
      : gapMass
        ? gapMassLabel(span.gap)
        : 'no single residue';
    // a narrow mark keeps at least its residue, and the whole label is always one hover away
    const short = matched
      ? residueList(span.candidates)
      : gapMass
        ? span.gap.toFixed(2)
        : '';
    const fits = (text: string) => right - left > text.length * 6.4 + 4;
    const shown = fits(label) ? label : short && fits(short) ? short : '';
    return (
      <g key={'step-' + span.from + '-' + span.to}>
        <title>{label}</title>
        <path
          d={`M ${left} ${level + 8} V ${level} H ${right} V ${level + 8}`}
          fill="none"
          stroke={color}
          strokeWidth={1.4}
          strokeDasharray={matched && !span.toPrecursor ? undefined : '4 3'}
        />
        {shown && (
          <text
            x={(left + right) / 2}
            y={level - 5}
            textAnchor="middle"
            fontSize={12}
            fontFamily={font}
            fill={color}
          >
            {shown}
          </text>
        )}
      </g>
    );
  });

  // a saved gap no residue fits is shown only while gap masses are switched on
  const shownMarks = (chain: SavedChain) =>
    chain.marks.filter((mark) => mark.candidates.length > 0 || gapMass);
  // saved chains sit in a band above the live plot, each on as many rows as its overlapping marks need
  const savedLayout = saved.reduce<
    { first: number; lanes: number[]; count: number }[]
  >((layout, chain) => {
    const previous = layout[layout.length - 1];
    const first = previous ? previous.first + previous.count : 0;
    return [...layout, { first, ...markLanes(shownMarks(chain)) }];
  }, []);
  const savedLines = savedLayout.reduce((sum, l) => sum + l.count, 0);
  const band = saved.length > 0 ? savedLines * savedRow + 6 : 0;
  const savedRows = saved.map((chain, n) => {
    const { first, lanes } = savedLayout[n];
    const level = 18 + first * savedRow;
    return (
      <g key={'saved-' + chain.id} data-testid={'annotate-saved-' + chain.id}>
        <text
          x={margin.left - 6}
          y={level + 4}
          textAnchor="end"
          fontSize={11}
          fontFamily={font}
          fontWeight={600}
          fill={chain.color}
        >
          {`${chain.id} (${chain.charge}+)`}
        </text>
        {/* remove this saved chain; left out of the downloaded figure */}
        <text
          data-export="no"
          data-testid={'annotate-remove-saved-' + chain.id}
          role="button"
          tabIndex={0}
          aria-label={`Remove saved chain ${chain.id}`}
          x={4}
          y={level + 4}
          fontSize={13}
          fontFamily={font}
          fill="#6b7280"
          style={{ cursor: 'pointer' }}
          onClick={() => onRemoveSaved(chain.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onRemoveSaved(chain.id);
            }
          }}
        >
          <title>Remove saved chain {chain.id}</title>×
        </text>
        {shownMarks(chain).map((mark, m) => {
          const markLevel = level + lanes[m] * savedRow;
          const ends = [xScale(peaks[mark.from][0]), xScale(peaks[mark.to][0])];
          const left = Math.max(Math.min(...ends), margin.left);
          const right = Math.min(Math.max(...ends), width - margin.right);
          if (right <= left) {
            return null;
          }
          const label =
            mark.candidates.length > 0
              ? `${residueList(mark.candidates)} ${formatError(mark.candidates[0], errorUnit, 1)}`
              : gapMassLabel(mark.gap);
          const short =
            mark.candidates.length > 0
              ? residueList(mark.candidates)
              : mark.gap.toFixed(2);
          const fits = (text: string) => right - left > text.length * 6 + 4;
          const shown = fits(label) ? label : fits(short) ? short : '';
          return (
            <g key={mark.from + '-' + mark.to}>
              <title>{label}</title>
              <path
                d={`M ${left} ${markLevel + 6} V ${markLevel} H ${right} V ${markLevel + 6}`}
                fill="none"
                stroke={chain.color}
                strokeWidth={1.4}
                strokeDasharray={
                  mark.toPrecursor || mark.candidates.length === 0
                    ? '4 3'
                    : undefined
                }
              />
              {shown && (
                <text
                  x={(left + right) / 2}
                  y={markLevel - 3}
                  textAnchor="middle"
                  fontSize={11}
                  fontFamily={font}
                  fill={chain.color}
                >
                  {shown}
                </text>
              )}
            </g>
          );
        })}
      </g>
    );
  });

  const xTicks = xScale.ticks(Math.max(4, Math.floor(width / 110)));
  const yTicks = yScale.ticks(5);
  const hoverNeighbour = hover === null ? undefined : neighbourMap.get(hover);

  return (
    <div className="annotate-plot" ref={frameRef}>
      <div className="annotate-plot-tools">
        <span className="annotate-legend">
          <i style={{ background: colors.picked }} /> your peaks
          <i style={{ background: colors.neighbour }} /> one residue from the
          last peak you picked
          {precursor >= 0 && (
            <>
              <i className="annotate-legend-dashed" /> precursor
            </>
          )}
        </span>
        {onSaveChain && (
          <Button size="small" type="primary" onClick={onSaveChain}>
            Save chain
          </Button>
        )}
        <Button
          size="small"
          disabled={!zoom && yTop === null}
          onClick={() => {
            setZoom(null);
            setYTop(null);
          }}
        >
          Reset zoom
        </Button>
      </div>
      <svg
        ref={svgRef}
        width={width}
        height={height + band}
        viewBox={`0 0 ${width} ${height + band}`}
        xmlns="http://www.w3.org/2000/svg"
        role="group"
        aria-label="Centroid MS/MS spectrum"
      >
        <rect width={width} height={height + band} fill="#ffffff" />
        {savedRows}
        <g transform={`translate(0, ${band})`}>
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke={colors.axis}
          />
          <line
            x1={margin.left}
            x2={margin.left}
            y1={yScale.range()[1]}
            y2={yScale(0)}
            stroke={colors.axis}
          />
          {xTicks.map((tick) => (
            <g key={'x-' + tick}>
              <line
                x1={xScale(tick)}
                x2={xScale(tick)}
                y1={yScale(0)}
                y2={yScale(0) + 6}
                stroke={colors.axis}
              />
              <text
                x={xScale(tick)}
                y={yScale(0) + 20}
                textAnchor="middle"
                fontSize={12}
                fontFamily={font}
                fill={colors.axis}
              >
                {tick}
              </text>
            </g>
          ))}
          {yTicks.map((tick) => (
            <g key={'y-' + tick}>
              <line
                x1={margin.left - 6}
                x2={margin.left}
                y1={yScale(tick)}
                y2={yScale(tick)}
                stroke={colors.axis}
              />
              <text
                x={margin.left - 10}
                y={yScale(tick) + 4}
                textAnchor="end"
                fontSize={12}
                fontFamily={font}
                fill={colors.axis}
              >
                {tick}
              </text>
            </g>
          ))}
          <text
            x={(margin.left + width - margin.right) / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize={13}
            fontFamily={font}
            fill={colors.axis}
          >
            m/z
          </text>
          <text
            transform={`translate(15, ${(height + margin.top - margin.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={13}
            fontFamily={font}
            fill={colors.axis}
          >
            Relative intensity (%)
          </text>
          {sticks}
          {savedDots}
          {precursor >= 0 && visible.includes(precursor) && (
            <text
              transform={`translate(${xScale(peaks[precursor][0]) - 5}, ${margin.top + 62}) rotate(-90)`}
              fontSize={12}
              fontFamily={font}
              fill={colors.precursor}
            >
              Precursor
            </text>
          )}
          {neighbourMarks}
          {pickMarks}
          {brackets}
          <g data-export="no">
            {hover !== null && !drag && (
              <g pointerEvents="none">
                <line
                  x1={xScale(peaks[hover][0])}
                  x2={xScale(peaks[hover][0])}
                  y1={yScale(0)}
                  y2={y(hover)}
                  stroke="#111827"
                  strokeWidth={2.4}
                />
                <text
                  x={Math.min(xScale(peaks[hover][0]) + 8, width - 190)}
                  y={margin.top - 8}
                  fontSize={12}
                  fontFamily={font}
                  fill="#111827"
                >
                  {describe(hover)}
                  {hoverNeighbour
                    ? ` · ${residueList(hoverNeighbour.candidates)} ${formatError(hoverNeighbour.candidates[0], errorUnit, 1)}`
                    : ''}
                </text>
              </g>
            )}
            {drag && !drag.select && (
              <rect
                x={Math.min(drag.start, drag.now)}
                y={margin.top}
                width={Math.abs(drag.now - drag.start)}
                height={height - margin.top - margin.bottom}
                fill="rgba(5, 109, 220, 0.12)"
                pointerEvents="none"
              />
            )}
            {drag && drag.select && (
              <rect
                data-testid="annotate-select-box"
                x={Math.min(drag.start, drag.now)}
                y={Math.min(drag.startY, drag.nowY)}
                width={Math.abs(drag.now - drag.start)}
                height={Math.abs(drag.nowY - drag.startY)}
                fill="rgba(5, 109, 220, 0.08)"
                stroke="rgb(5, 109, 220)"
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            )}
            <rect
              ref={xAxisRef}
              data-testid="annotate-x-axis"
              x={margin.left}
              y={height - margin.bottom}
              width={width - margin.left - margin.right}
              height={margin.bottom}
              fill="transparent"
              style={{ cursor: 'ew-resize', touchAction: 'none' }}
              onPointerDown={pullStart('x')}
              onPointerMove={pullMove}
              onPointerUp={pullEnd}
              onPointerCancel={pullEnd}
              onDoubleClick={() => setZoom(null)}
            >
              <title>
                Drag right to zoom in on m/z, left to zoom out, or scroll.
                Double-click to zoom fully out.
              </title>
            </rect>
            <rect
              ref={yAxisRef}
              data-testid="annotate-y-axis"
              x={0}
              y={0}
              width={margin.left}
              height={height - margin.bottom}
              fill="transparent"
              style={{ cursor: 'ns-resize', touchAction: 'none' }}
              onPointerDown={pullStart('y')}
              onPointerMove={pullMove}
              onPointerUp={pullEnd}
              onPointerCancel={pullEnd}
              onDoubleClick={() => setYTop(null)}
            >
              <title>
                Drag up to zoom in on intensity, down to zoom out, or scroll.
                Double-click to zoom fully out.
              </title>
            </rect>
            <rect
              data-testid="annotate-hit-area"
              className="annotate-hit-area"
              role="button"
              tabIndex={0}
              aria-label="Peaks. Left and right arrows move between peaks, with Shift to jump ten, Enter selects. With a mouse, click a peak, drag to zoom, or drag with the right button to pick every peak whose top is in the box."
              x={margin.left}
              y={0}
              width={width - margin.left - margin.right}
              height={height - margin.bottom}
              fill="transparent"
              style={{ cursor: 'crosshair', touchAction: 'none' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => setHover(null)}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={handleKeyDown}
              onBlur={() => setHover(null)}
            />
            {labelTargets.map((target) => (
              <rect
                key={'target-' + target.peak}
                data-testid={'annotate-name-' + target.peak}
                data-mz={peaks[target.peak][0]}
                x={target.x}
                y={target.y}
                width={target.width}
                height={target.height}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => onTogglePeak(target.peak)}
                onPointerEnter={() => setHover(target.peak)}
                onPointerLeave={() => setHover(null)}
              />
            ))}
          </g>
        </g>
      </svg>
      <span className="annotate-live" aria-live="polite">
        {hover === null
          ? ''
          : `${describe(hover)}${pickedSet.has(hover) ? ', selected' : ''}${hoverNeighbour ? `, ${residueList(hoverNeighbour.candidates)}` : ''}`}
      </span>
    </div>
  );
}

export default AnnotateSpectrum;
