import { useEffect, useState } from 'react';
import { Descriptions, Spin, Tag, Typography } from 'antd';

const { Text } = Typography;

// ── Types & constants ─────────────────────────────────────────────────────────

export type BgcGene = {
  start: number; end: number; strand: 1 | -1;
  label: string; product: string;
  category: 'core' | 'precursor' | 'transport' | 'regulatory' | 'resistance' | 'other';
};

export const BGC_COLORS: Record<BgcGene['category'], string> = {
  core: '#810e15', precursor: '#d62728', transport: '#17aeff',
  regulatory: '#f0a30a', resistance: '#e377c2', other: '#aaaaaa',
};

export const BGC_CATEGORY_LABELS: Record<BgcGene['category'], string> = {
  core: 'Core biosynthesis', precursor: 'Precursor peptide', transport: 'Transport',
  regulatory: 'Regulatory', resistance: 'Resistance', other: 'Other',
};

export function categorizeBgcGene(product: string, note: string): BgcGene['category'] {
  const s = (product + ' ' + note).toLowerCase();
  if (/precursor|leader|core.pep|prepeptide/.test(s)) return 'precursor';
  if (/transport|permease|efflux|\babc\b/.test(s)) return 'transport';
  if (/regulat|repressor|activator|\bsigma\b/.test(s)) return 'regulatory';
  if (/resist|immunity|self.protect/.test(s)) return 'resistance';
  if (/synthas|synthetat|cyclase|reductase|oxidase|dehydrogen|protease|peptidase|modification|lanthipeptide|lantibiotic|thiopeptide|\bripp\b/.test(s)) return 'core';
  return 'other';
}

export function parseGenbankCds(text: string): BgcGene[] {
  const featMatch = text.match(/^FEATURES\s+Location\/Qualifiers([\s\S]*?)^(?:ORIGIN|CONTIG)/m);
  if (!featMatch) return [];
  const genes: BgcGene[] = [];
  const blocks = featMatch[1].split(/(?=\s{5}CDS\s)/);
  for (const block of blocks) {
    if (!/^\s{5}CDS\s/.test(block)) continue;
    const locMatch = block.match(/^\s{5}CDS\s+([\s\S]+?)(?=\s{21}\/)/);
    if (!locMatch) continue;
    const locStr = locMatch[1].replace(/\s+/g, '');
    const strand: 1 | -1 = locStr.includes('complement') ? -1 : 1;
    const coordMatches = [...locStr.matchAll(/(\d+)\.\.(\d+)/g)];
    if (coordMatches.length === 0) continue;
    const nums = coordMatches.flatMap(m => [parseInt(m[1]), parseInt(m[2])]);
    const geneMatch = block.match(/\/gene="([^"]+)"/);
    const productMatch = block.match(/\/product="([\s\S]+?)"/);
    const noteMatch = block.match(/\/note="([\s\S]+?)"/);
    const label = geneMatch?.[1] ?? '';
    const product = (productMatch?.[1] ?? '').replace(/\s+/g, ' ').trim();
    const note = (noteMatch?.[1] ?? '').replace(/\s+/g, ' ').trim();
    genes.push({
      start: Math.min(...nums), end: Math.max(...nums), strand,
      label, product, category: categorizeBgcGene(product, note),
    });
  }
  return genes;
}

// ── SVG gene map ──────────────────────────────────────────────────────────────

export function BgcGeneMap({
  genes, bgcStart, bgcEnd, bgcClass, loading, error,
}: {
  genes: BgcGene[];
  bgcStart: number | null;
  bgcEnd: number | null;
  bgcClass?: string[];
  loading?: boolean;
  error?: boolean;
}) {
  if (loading) return <div style={{ fontSize: 12, color: '#6b7280' }}>Loading BGC gene map from NCBI…</div>;
  if (error) return <div style={{ fontSize: 12, color: '#dc2626' }}>Could not load gene map: the GenBank record may not be available or the region could not be parsed.</div>;
  if (genes.length === 0) return null;

  const W = 1200, H = 160, TY = 72, AH = 32, TIP = 14;
  const minPos = Math.min(...genes.map(g => g.start));
  const maxPos = Math.max(...genes.map(g => g.end));
  const span = Math.max(maxPos - minPos, 1);
  const toX = (p: number) => ((p - minPos) / span) * W;
  const arrowPts = (g: BgcGene) => {
    const x1 = toX(g.start);
    const x2 = Math.max(toX(g.end), x1 + 5);
    const tip = Math.min(TIP, (x2 - x1) * 0.45);
    if (g.strand === 1) {
      const y0 = TY - AH, y1 = TY;
      return `${x1},${y0} ${x2 - tip},${y0} ${x2},${(y0 + y1) / 2} ${x2 - tip},${y1} ${x1},${y1}`;
    } else {
      const y0 = TY, y1 = TY + AH;
      return `${x1 + tip},${y0} ${x2},${y0} ${x2},${y1} ${x1 + tip},${y1} ${x1},${(y0 + y1) / 2}`;
    }
  };
  const displayStart = bgcStart ?? minPos;
  const displayEnd = bgcEnd ?? maxPos;

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151' }}>BGC Gene Map</span>
        {bgcClass?.map(cls => (
          <span key={cls} style={{ fontSize: 11, background: '#dbeafe', color: '#1e40af', borderRadius: 4, padding: '1px 7px', fontWeight: 500 }}>{cls}</span>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          style={{ display: 'block', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb', minWidth: 400 }}
        >
          <line x1={0} y1={TY} x2={W} y2={TY} stroke="#d1d5db" strokeWidth={1.5} />
          <text x={2} y={H - 6} fontSize={9} fill="#9ca3af">{displayStart.toLocaleString()} bp</text>
          <text x={W - 2} y={H - 6} fontSize={9} fill="#9ca3af" textAnchor="end">{displayEnd.toLocaleString()} bp</text>
          <text x={W - 2} y={TY - 4} fontSize={9} fill="#9ca3af" textAnchor="end">+ strand</text>
          <text x={W - 2} y={TY + 12} fontSize={9} fill="#9ca3af" textAnchor="end">− strand</text>
          {genes.map((g, i) => {
            const x1 = toX(g.start);
            const x2 = Math.max(toX(g.end), x1 + 5);
            const midX = (x1 + x2) / 2;
            const midY = g.strand === 1 ? TY - AH / 2 : TY + AH / 2;
            const color = BGC_COLORS[g.category];
            const labelMaxChars = Math.max(Math.floor((x2 - x1) / 6), 0);
            const displayLabel = g.label.length > labelMaxChars ? g.label.slice(0, labelMaxChars - 1) + '\u2026' : g.label;
            return (
              <g key={i}>
                <polygon points={arrowPts(g)} fill={color} stroke="#fff" strokeWidth={0.5} opacity={0.9}>
                  <title>{[g.label, g.product].filter(Boolean).join(', ') || 'hypothetical protein'}, {g.start.toLocaleString()}bp–{g.end.toLocaleString()}bp ({(g.end - g.start).toLocaleString()} bp)</title>
                </polygon>
                {(x2 - x1) > 22 && g.label && (
                  <text x={midX} y={midY + 4} fontSize={9} fill="#fff" textAnchor="middle" style={{ pointerEvents: 'none' }}>
                    {displayLabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap', fontSize: 13, color: '#374151' }}>
        {(Object.keys(BGC_COLORS) as BgcGene['category'][]).map(cat => (
          <span key={cat} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 14, height: 14, background: BGC_COLORS[cat], borderRadius: 3, flexShrink: 0 }} />
            {BGC_CATEGORY_LABELS[cat]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Probe MIBiG website to find the correct versioned accession ───────────────

async function resolveVersionedAccession(bare: string, maxVersion: number): Promise<string> {
  for (let v = maxVersion; v >= 1; v--) {
    const versioned = `${bare}.${v}`;
    try {
      const res = await fetch(
        `https://mibig.secondarymetabolites.org/repository/${versioned}/`,
        { method: 'HEAD' },
      );
      if (res.ok) return versioned;
    } catch { /* network error — keep trying lower versions */ }
  }
  return bare; // fallback: bare accession
}

// ── Async loader — given a MIBiG accession, fetch + render the gene map ───────

type BgcState = {
  genes: BgcGene[];
  bgcStart: number | null;
  bgcEnd: number | null;
  bgcClass: string[];
  genbank: string;
  organism: string;
  versionedAccession: string;
  loading: boolean;
  error: boolean;
};

export function BgcSectionFromMibig({ mibig }: { mibig: string }) {
  const [state, setState] = useState<BgcState>({
    genes: [], bgcStart: null, bgcEnd: null, bgcClass: [],
    genbank: '', organism: '', versionedAccession: '', loading: true, error: false,
  });

  useEffect(() => {
    if (!mibig) return;
    let cancelled = false;

    async function load() {
      setState(s => ({ ...s, loading: true, error: false }));
      try {
        const mibigRes = await fetch(
          `https://raw.githubusercontent.com/mibig-secmet/mibig-json/master/data/${mibig.toUpperCase()}.json`,
        );
        if (!mibigRes.ok || cancelled) { setState(s => ({ ...s, loading: false, error: true })); return; }
        const json = await mibigRes.json();
        const cluster = json?.cluster;
        const bgcClass: string[] = cluster?.biosyn_class ?? [];
        const genbank: string = cluster?.loci?.accession ?? '';
        const bgcStart: number | null = cluster?.loci?.start_coord ?? null;
        const bgcEnd: number | null = cluster?.loci?.end_coord ?? null;
        const organism: string = cluster?.organism_name ?? '';
        // Probe MIBiG website to find the real versioned accession (e.g. BGC0000544.4)
        const changelogLen: number = Array.isArray(json?.changelog) ? json.changelog.length : 1;
        const versionedAccession = await resolveVersionedAccession(mibig.toUpperCase(), changelogLen + 2);

        if (!genbank || cancelled) {
          setState(s => ({ ...s, loading: false, bgcClass, genbank, bgcStart, bgcEnd, organism, versionedAccession }));
          return;
        }

        const gbRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${genbank}&rettype=gb&retmode=text`);
        if (!gbRes.ok || cancelled) { setState(s => ({ ...s, loading: false, error: true, bgcClass, genbank, bgcStart, bgcEnd, organism, versionedAccession })); return; }
        const gbText = await gbRes.text();
        const genes = parseGenbankCds(gbText);
        if (!cancelled) setState({ genes, bgcStart, bgcEnd, bgcClass, genbank, organism, versionedAccession, loading: false, error: false });
      } catch {
        if (!cancelled) setState(s => ({ ...s, loading: false, error: true }));
      }
    }

    load();
    return () => { cancelled = true; };
  }, [mibig]);

  return (
    <div style={{ padding: '8px 0' }}>
      <Descriptions bordered size="small" column={2} style={{ marginBottom: 8 }} items={[
        { key: 'mibig', label: 'MIBiG', children: <Text code>{state.versionedAccession || mibig.toUpperCase()}</Text> },
        ...(state.genbank ? [{ key: 'gb', label: 'GenBank', children: <Text code>{state.genbank}</Text> }] : []),
        ...(state.bgcStart != null ? [{ key: 'bgcs', label: 'BGC start', children: `${state.bgcStart.toLocaleString()} bp` }] : []),
        ...(state.bgcEnd != null ? [{ key: 'bgce', label: 'BGC end', children: `${state.bgcEnd.toLocaleString()} bp` }] : []),
        ...(state.organism ? [{ key: 'org', label: 'Organism', children: state.organism, span: 2 as const }] : []),
        ...(state.bgcClass.length > 0 ? [{
          key: 'cls', label: 'BGC class',
          children: <>{state.bgcClass.map(c => <Tag key={c} color="blue">{c}</Tag>)}</>,
        }] : []),
      ]} />
      {state.loading && <Spin size="small" style={{ marginTop: 8 }} />}
      {!state.loading && (
        <BgcGeneMap
          genes={state.genes}
          bgcStart={state.bgcStart}
          bgcEnd={state.bgcEnd}
          bgcClass={state.bgcClass}
          error={state.error}
        />
      )}
    </div>
  );
}
