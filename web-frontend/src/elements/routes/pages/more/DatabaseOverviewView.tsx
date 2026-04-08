import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Content } from 'antd/es/layout/layout';
import { Spin } from 'antd';
import fetchData from '../../../../utils/request/fetchData';
import initFlags from '../../../../utils/initFlags';
import ContentFilterOptions from '../../../../types/filterOptions/ContentFilterOtions';
import ValueCount from '../../../../types/ValueCount';
import Metadata from '../../../../types/Metadata';
import RequestResponse from '../../../../types/RequestResponse';
import { usePropertiesContext } from '../../../../context/properties/properties';
import useContainerDimensions from '../../../../utils/useContainerDimensions';
import SectionDivider from '../../../basic/SectionDivider';
import MetadataPanel from '../content/MetadataPanel';
import segmentedWidth from '../../../../constants/segmentedWidth';
import { SUBMISSIONS_KEY, RiPPSubmission } from '../submit/SubmitView';

const ContentChart = lazy(() => import('../content/ContentChart'));

async function fetchDoiAuthors(doi: string): Promise<string[]> {
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!res.ok) return [];
    const json = await res.json();
    const authors: { family?: string; given?: string }[] = json?.message?.author ?? [];
    return authors
      .filter((a) => a.family)
      .map((a) => (a.given ? `${a.family}, ${a.given}` : a.family!));
  } catch {
    return [];
  }
}

function buildContributorCounts(authorsByDoi: Map<string, string[]>): ValueCount[] {
  const map = new Map<string, number>();
  for (const authors of authorsByDoi.values()) {
    for (const author of authors) {
      map.set(author, (map.get(author) ?? 0) + 1);
    }
  }
  return Array.from(map.entries()).map(([value, count]) => ({ value, count }));
}

function buildRippTypeCounts(subs: RiPPSubmission[]): ValueCount[] {
  const map = new Map<string, number>();
  for (const s of subs) {
    if (s.compoundClass) map.set(s.compoundClass, (map.get(s.compoundClass) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([value, count]) => ({ value, count }));
}

function DatabaseOverviewView() {
  const ref = useRef<HTMLDivElement>(null);
  const { width } = useContainerDimensions(ref);
  const { backendUrl } = usePropertiesContext();
  const [loading, setLoading] = useState(true);
  const [propertyFilterOptions, setPropertyFilterOptions] = useState<ContentFilterOptions | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch metadata from backend
      const metaRes = (await fetchData(backendUrl + '/metadata')) as RequestResponse<Metadata>;
      if (metaRes.status === 'success') setMetadata(metaRes.data ?? null);

      // Build charts from localStorage submissions
      const subs: RiPPSubmission[] = (() => {
        try { return JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? '[]'); }
        catch { return []; }
      })();

      // Collect unique DOIs across all submissions
      const uniqueDois = [...new Set(subs.flatMap((s) => s.dois ?? []).filter(Boolean))];

      // Fetch authors for each DOI from CrossRef
      const authorsByDoi = new Map<string, string[]>();
      await Promise.all(
        uniqueDois.map(async (doi) => {
          const authors = await fetchDoiAuthors(doi);
          if (authors.length > 0) authorsByDoi.set(doi, authors);
        }),
      );

      const options: ContentFilterOptions = {
        contributor: buildContributorCounts(authorsByDoi),
        instrument_type: [],
        ion_mode: [],
        ms_type: [],
        ripp_type: buildRippTypeCounts(subs),
      };
      initFlags(options);
      setPropertyFilterOptions(options);
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const charts = useMemo(() => {
    if (!propertyFilterOptions) return null;
    const chartWidth = Math.max((width - segmentedWidth) / 2, 200);
    const chartHeight = 300;
    const chartsToShow: { key: keyof ContentFilterOptions; label: string; description: string }[] = [
      {
        key: 'contributor',
        label: 'Top Contributors by DOI',
        description: 'Shows the researchers who appear most frequently as authors in the publication DOIs linked to records in the database.',
      },
      {
        key: 'ripp_type',
        label: 'RiPP Class Distribution',
        description: 'Breakdown of the different RiPP compound classes represented in the database.',
      },
    ];
    return (
      <Content
        style={{
          width: width - segmentedWidth,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          justifyContent: 'center',
          alignItems: 'start',
          textAlign: 'center',
        }}
      >
        {chartsToShow.map(({ key, label, description }) =>
          (propertyFilterOptions[key] as ValueCount[] | undefined)?.length ? (
            <div key={'chart_wrapper_' + key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <ContentChart
                content={propertyFilterOptions}
                identifier={key}
                width={chartWidth}
                height={chartHeight}
                overrideTitle={label}
              />
              <p style={{ fontSize: 12, color: '#6b7280', maxWidth: chartWidth - 24, textAlign: 'center', marginTop: 4, lineHeight: 1.5, padding: '0 12px' }}>
                {description}
              </p>
            </div>
          ) : null,
        )}
      </Content>
    );
  }, [propertyFilterOptions, width]);

  if (loading) {
    return (
      <div ref={ref} style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div ref={ref} style={{ width: '100%', height: '100%' }}>
      <SectionDivider label="Charts" />
      {charts}
      <SectionDivider label="Information" />
      <MetadataPanel metadata={metadata} />
    </div>
  );
}

export default DatabaseOverviewView;
