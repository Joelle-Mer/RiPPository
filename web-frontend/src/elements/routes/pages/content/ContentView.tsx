import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useContainerDimensions from '../../../../utils/useContainerDimensions';
import Hit from '../../../../types/Hit';
import Peak from '../../../../types/peak/Peak';
import ContentFilterOptions from '../../../../types/filterOptions/ContentFilterOtions';
import { Form, Input, InputNumber, Layout, Spin, Typography } from 'antd';
import { Content } from 'antd/es/layout/layout';
import SearchFields from '../../../../types/filterOptions/SearchFields';
import SearchAndResultPanel from '../../../common/SearchAndResultPanel';
import CommonSearchPanel from '../../../common/CommonSearchPanel';
import PropertyFilterOptionsMenuItems from '../search/searchPanel/msSpecFilter/PropertyFilterOptionsMenuItems';
import defaultSearchFieldValues from '../../../../constants/defaultSearchFieldValues';
import ResultTableSortOption from '../../../../types/ResultTableSortOption';
import sortHits from '../../../../utils/sortHits';
import collapseButtonWidth from '../../../../constants/collapseButtonWidth';
import ErrorElement from '../../../basic/ErrorElement';
import { SUBMISSIONS_KEY, RiPPSubmission } from '../submit/SubmitView';
import { parsePeakList } from '../../../../utils/chemistry';
import Chart from '../../../basic/Chart';

const { Text } = Typography;
const defaultSearchPanelWidth = 450;

function cosineSimilarity(
  query: { mz: number; intensity: number }[],
  target: { mz: number; intensity: number }[],
  mzTol = 0.05,
): number {
  if (query.length === 0 || target.length === 0) return 0;
  const normQ = Math.sqrt(query.reduce((s, p) => s + p.intensity * p.intensity, 0));
  const normT = Math.sqrt(target.reduce((s, p) => s + p.intensity * p.intensity, 0));
  if (normQ === 0 || normT === 0) return 0;
  let dot = 0;
  for (const q of query) {
    let best = 0, bestDist = Infinity;
    for (const t of target) {
      const d = Math.abs(t.mz - q.mz);
      if (d <= mzTol && d < bestDist) { best = t.intensity; bestDist = d; }
    }
    dot += q.intensity * best;
  }
  return dot / (normQ * normT);
}

function submissionToHit(sub: RiPPSubmission, idx: number): Hit {
  const peaks = (sub.peaks ?? []).map((p, i) => ({ ...p, id: String(i) }));
  return {
    index: idx,
    accession: sub.accession,
    atomcount: 0,
    record: {
      accession: sub.accession,
      title: sub.recordTitle,
      date: { created: sub.date, modified: sub.date, updated: sub.date },
      authors: [{ name: sub.orcidName ? `${sub.orcidName} (${sub.orcid})` : sub.orcid }],
      publication: (sub.dois ?? []).join(', '),
      license: sub.license,
      copyright: '',
      compound: {
        names: [sub.compoundName],
        classes: [sub.compoundClass],
        formula: sub.formula,
        mass: sub.exactMass ?? 0,
        smiles: sub.smiles ?? '',
        inchi: sub.inchi ?? '',
        link: (sub.dbLinks ?? []).map((l) => ({ db: l.db, id: l.id, url: '' })),
      },
      species: {
        name: sub.origin?.organism ?? '',
        strain: sub.origin?.strain ?? undefined,
        lineage: [],
        link: [],
        sample: sub.origin?.source ? [sub.origin.source] : [],
      },
      acquisition: {
        instrument: sub.instrument,
        instrument_type: sub.instrumentType,
        chromatography: [],
        mass_spectrometry: {
          ion_mode: sub.ionMode,
          ms_type: sub.msType,
          subtags: [
            ...(sub.collisionEnergy ? [{ subtag: 'COLLISION_ENERGY', value: sub.collisionEnergy }] : []),
            ...(sub.ionization ? [{ subtag: 'IONIZATION', value: sub.ionization }] : []),
          ],
        },
      },
      mass_spectrometry: {
        focused_ion: sub.precursorType
          ? [{ subtag: 'PRECURSOR_TYPE', value: sub.precursorType }]
          : [],
        data_processing: [],
      },
      peak: {
        splash: sub.splash ?? '',
        numPeak: sub.numPeak,
        peak: {
          header: ['m/z', 'int.', 'rel.int.'],
          values: peaks,
        },
        neutral_loss: [],
      },
      comments: [
        ...(sub.bioactivity ?? []).map((b) => ({
          subtag: 'BIOACTIVITY',
          value: b.activity + (b.target ? ` (${b.target})` : ''),
        })),
        ...(sub.note ? [{ subtag: 'NOTE', value: sub.note }] : []),
        ...(sub.genome?.mibig ? [{ subtag: 'MIBIG', value: sub.genome.mibig }] : []),
      ],
    },
  } as Hit;
}

function getAllSubmissions(): RiPPSubmission[] {
  try {
    return JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function buildFilterOptions(subs: RiPPSubmission[]): ContentFilterOptions {
  const toCounts = (values: string[]): { value: string; count: number }[] => {
    const map = new Map<string, number>();
    values.forEach((v) => { if (v) map.set(v, (map.get(v) ?? 0) + 1); });
    return Array.from(map.entries()).map(([value, count]) => ({ value, count }));
  };
  return {
    contributor: [],
    instrument_type: toCounts(subs.map((s) => s.instrumentType).filter(Boolean)),
    ion_mode: toCounts(subs.map((s) => s.ionMode).filter(Boolean)),
    ms_type: toCounts(subs.map((s) => s.msType).filter(Boolean)),
    ripp_type: toCounts(subs.map((s) => s.compoundClass).filter(Boolean)),
  };
}

function ContentView() {
  const ref = useRef(null);
  const { width, height } = useContainerDimensions(ref);

  const [isFetchingContent, setIsFetchingContent] = useState<boolean>(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [propertyFilterOptions, setPropertyFilterOptions] =
    useState<ContentFilterOptions | null>(null);
  const [searchPanelWidth, setSearchPanelWidth] = useState<number>(defaultSearchPanelWidth);
  const [queryPeaks, setQueryPeaks] = useState<Peak[] | null>(null);

  const handleOnFetchContent = useCallback(async () => {
    const subs = getAllSubmissions();
    setPropertyFilterOptions(buildFilterOptions(subs));
    setIsFetchingContent(false);
  }, []);

  /** Applies all active filters (property checkboxes + text inputs) and sets hits. */
  const handleOnSubmit = useCallback(async (formData: SearchFields) => {
    setIsSearching(true);
    let subs = getAllSubmissions();

    // Checkbox property filters
    const rippSelected = (formData?.propertyFilterOptions?.ripp_type ?? []) as string[];
    const instrSelected = (formData?.propertyFilterOptions?.instrument_type ?? []) as string[];
    const ionSelected = (formData?.propertyFilterOptions?.ion_mode ?? []) as string[];
    const msSelected = (formData?.propertyFilterOptions?.ms_type ?? []) as string[];
    if (rippSelected.length > 0) subs = subs.filter((s) => rippSelected.includes(s.compoundClass));
    if (instrSelected.length > 0) subs = subs.filter((s) => instrSelected.includes(s.instrumentType));
    if (ionSelected.length > 0) subs = subs.filter((s) => ionSelected.includes(s.ionMode));
    if (msSelected.length > 0) subs = subs.filter((s) => msSelected.includes(s.msType));

    // Text filters (compound name / accession / formula)
    const name = (formData?.compoundSearchFilterOptions?.compoundName ?? '').trim().toLowerCase();
    const formula = (formData?.compoundSearchFilterOptions?.formula ?? '').trim().toLowerCase();
    if (name) {
      subs = subs.filter((s) =>
        s.compoundName?.toLowerCase().includes(name) ||
        s.accession?.toLowerCase().includes(name) ||
        s.recordTitle?.toLowerCase().includes(name) ||
        s.compoundClass?.toLowerCase().includes(name) ||
        s.inchi?.toLowerCase().includes(name) ||
        s.inchikey?.toLowerCase().includes(name) ||
        s.precursorSeq?.toLowerCase().includes(name) ||
        (s.dois ?? []).some((d) => d.toLowerCase().includes(name)) ||
        s.origin?.organism?.toLowerCase().includes(name) ||
        s.note?.toLowerCase().includes(name),
      );
    }
    if (formula) {
      subs = subs.filter(
        (s) =>
          s.formula?.toLowerCase().includes(formula) ||
          s.compoundName?.toLowerCase().includes(formula),
      );
    }

    // Monoisotopic mass filter
    const exactMass = formData?.compoundSearchFilterOptions?.exactMass;
    if (exactMass != null && !isNaN(exactMass)) {
      const tol = formData?.compoundSearchFilterOptions?.massTolerance ?? 0.1;
      subs = subs.filter((s) => Math.abs((s.exactMass ?? 0) - exactMass) <= tol);
    }

    // Spectral similarity filter
    let similarityScores: Map<RiPPSubmission, number> | null = null;
    const peakListRaw = (formData?.spectralSearchFilterOptions?.similarity?.peakList ?? '').trim();
    if (peakListRaw) {
      const parsed = parsePeakList(peakListRaw);
      if (parsed && parsed.length > 0) {
        const parsedPeaks: Peak[] = parsed.map((p, i) => ({ ...p, id: String(i) }));
        setQueryPeaks(parsedPeaks);
        const threshold = formData?.spectralSearchFilterOptions?.similarity?.threshold ?? 0.8;
        const scored = subs
          .map((s) => {
            const targetPeaks = (s.peaks ?? []) as { mz: number; intensity: number }[];
            const score = cosineSimilarity(parsed, targetPeaks);
            return { sub: s, score };
          })
          .filter(({ score }) => score >= threshold)
          .sort((a, b) => b.score - a.score);
        subs = scored.map(({ sub }) => sub);
        similarityScores = new Map(scored.map(({ sub, score }) => [sub, score]));
      } else {
        setQueryPeaks(null);
      }
    } else {
      setQueryPeaks(null);
    }

    setHits(subs.map((s, i) => {
      const hit = submissionToHit(s, i);
      if (similarityScores) hit.score = similarityScores.get(s);
      return hit;
    }));
    setErrorMessage(null);
    setIsSearching(false);
  }, []);

  useEffect(() => {
    handleOnFetchContent();
    handleOnSubmit({} as SearchFields);
  }, [handleOnFetchContent, handleOnSubmit]);

  const searchPanelHeight = useMemo(() => height * 0.9, [height]);

  const handleOnCollapse = useCallback((_collapsed: boolean) => {
    setIsCollapsed(_collapsed);
    setSearchPanelWidth(_collapsed ? collapseButtonWidth : defaultSearchPanelWidth);
  }, []);

  const handleOnSelectSort = useCallback(
    (sortValue: ResultTableSortOption) => {
      const _hits = hits ? sortHits(hits, sortValue) : null;
      setHits(_hits);
    },
    [hits],
  );

  const handleOnResize = useCallback(
    (_searchPanelWidth: number) => {
      if (!isCollapsed) setSearchPanelWidth(_searchPanelWidth);
    },
    [isCollapsed],
  );

  const initialFilterValues = useMemo<SearchFields>(
    () => ({ ...(JSON.parse(JSON.stringify(defaultSearchFieldValues)) as SearchFields) }),
    [],
  );

  // Text search form items at top of the filter panel — same pattern as Search page
  const queryChartWidth = searchPanelWidth - 40;

  const textSearchItems = useMemo(() => [
    {
      key: 'textSearch',
      label: 'Search',
      children: [
        {
          key: 'textSearchInputs',
          style: { height: 'auto', paddingInline: 0 as const },
          label: (
            <div style={{ padding: '4px 8px 8px' }}>
              <Form.Item
                name={['compoundSearchFilterOptions', 'compoundName']}
                label="Compound name"
                style={{ marginBottom: 10 }}
              >
                <Input placeholder="e.g. Nisin A" allowClear />
              </Form.Item>
              <Form.Item
                name={['compoundSearchFilterOptions', 'formula']}
                label="Formula"
                style={{ marginBottom: 10 }}
              >
                <Input placeholder="e.g. C143H230N42O37S7" allowClear />
              </Form.Item>
              <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                <Form.Item
                  name={['compoundSearchFilterOptions', 'exactMass']}
                  label="Exact mass (Da)"
                  style={{ marginBottom: 0, flex: 1 }}
                >
                  <InputNumber
                    placeholder="e.g. 3354.5"
                    min={0}
                    step={0.001}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
                <Form.Item
                  name={['compoundSearchFilterOptions', 'massTolerance']}
                  label="±"
                  style={{ marginBottom: 0, width: 72 }}
                >
                  <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                </Form.Item>
              </div>
              {hits !== null && (
                <Text type="secondary" style={{ fontSize: 11, marginTop: 8, display: 'block' }}>
                  {hits.length} record{hits.length !== 1 ? 's' : ''} found
                </Text>
              )}
            </div>
          ),
        },
      ],
    },
    {
      key: 'spectralSearch',
      label: 'Spectral Similarity',
      children: [
        {
          key: 'spectralSearchInputs',
          style: { height: 'auto', paddingInline: 0 as const },
          label: (
            <div style={{ padding: '4px 8px 8px' }}>
              <Form.Item
                name={['spectralSearchFilterOptions', 'similarity', 'peakList']}
                label="Peak list"
                style={{ marginBottom: 10 }}
                help="One peak per line: m/z intensity"
              >
                <Input.TextArea
                  rows={5}
                  placeholder={'100.05 500\n150.12 1000\n200.08 300'}
                  style={{ fontFamily: 'monospace', fontSize: 11 }}
                />
              </Form.Item>
              <Form.Item
                name={['spectralSearchFilterOptions', 'similarity', 'threshold']}
                label="Min. similarity"
                style={{ marginBottom: queryPeaks ? 10 : 0 }}
              >
                <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
              </Form.Item>
              {queryPeaks && queryPeaks.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
                    Query spectrum ({queryPeaks.length} peaks)
                  </div>
                  <Chart
                    peakData={queryPeaks}
                    width={queryChartWidth}
                    height={120}
                    disableZoom
                    disableLabels
                    disableOnHover
                    disableExport
                  />
                </div>
              )}
            </div>
          ),
        },
      ],
    },
  ], [hits, queryPeaks, queryChartWidth]);

  const searchAndResultPanel = useMemo(() => {
    const filterItems = [
      ...textSearchItems,
      ...PropertyFilterOptionsMenuItems({ propertyFilterOptions, showCounts: true }),
    ];

    const searchPanel = (
      <CommonSearchPanel
        items={filterItems}
        collapsed={isCollapsed}
        onCollapse={handleOnCollapse}
        propertyFilterOptions={propertyFilterOptions}
        onSubmit={handleOnSubmit}
        onValuesChange={handleOnSubmit}
        width={searchPanelWidth}
        height={searchPanelHeight}
        initialValues={initialFilterValues}
        disableActiveKeys={true}
        hideSearchButton={true}
      />
    );

    return (
      <SearchAndResultPanel
        searchPanel={searchPanel}
        width={width}
        height={searchPanelHeight}
        searchPanelWidth={searchPanelWidth}
        widthOverview={width}
        heightOverview={height}
        hits={hits}
        isRequesting={isSearching}
        onSort={handleOnSelectSort}
        onResize={handleOnResize}
        reference={queryPeaks ?? undefined}
      />
    );
  }, [
    textSearchItems, propertyFilterOptions, isCollapsed, handleOnCollapse, handleOnSubmit,
    searchPanelWidth, searchPanelHeight, width, height, hits, isSearching,
    handleOnSelectSort, handleOnResize, initialFilterValues, queryPeaks,
  ]);

  return (
    <Layout
      ref={ref}
      style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', userSelect: 'none' }}
    >
      {isFetchingContent ? (
        <Spin size="large" />
      ) : errorMessage && !hits ? (
        <ErrorElement message={'An error occurred while trying to fetch the content.'} />
      ) : (
        <Content style={{ width: '100%', height: '100%', backgroundColor: 'white' }}>
          {searchAndResultPanel}
        </Content>
      )}
    </Layout>
  );
}

export default ContentView;
