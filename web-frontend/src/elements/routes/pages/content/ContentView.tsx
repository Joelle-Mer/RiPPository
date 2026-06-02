import { useCallback, useEffect, useMemo, useRef, useState, KeyboardEvent } from 'react';
import useContainerDimensions from '../../../../utils/useContainerDimensions';
import Hit from '../../../../types/Hit';
import Peak from '../../../../types/peak/Peak';
import ContentFilterOptions from '../../../../types/filterOptions/ContentFilterOtions';
import { Layout, Spin } from 'antd';
import { Content } from 'antd/es/layout/layout';
import SearchFields from '../../../../types/filterOptions/SearchFields';
import SearchAndResultPanel from '../../../common/SearchAndResultPanel';
import CommonSearchPanel from '../../../common/CommonSearchPanel';
import SearchPanelMenuItems from '../search/SearchPanelMenuItems';
import defaultSearchFieldValues from '../../../../constants/defaultSearchFieldValues';
import ResultTableSortOption from '../../../../types/ResultTableSortOption';
import sortHits from '../../../../utils/sortHits';
import collapseButtonWidth from '../../../../constants/collapseButtonWidth';
import ErrorElement from '../../../basic/ErrorElement';
import fetchData from '../../../../utils/request/fetchData';
import initFlags from '../../../../utils/initFlags';
import { usePropertiesContext } from '../../../../context/properties/properties';
import RequestResponse from '../../../../types/RequestResponse';
import SearchResult from '../../../../types/SearchResult';
import buildSearchParamsFromFormData from '../../../../utils/buildSearchParamsFromFormData';
import parsePeakListInputField from '../../../../utils/parsePeakListAndReferences';
import generateID from '../../../../utils/generateID';
import ValueCount from '../../../../types/ValueCount';

const defaultSearchPanelWidth = 450;

type ActiveFilters = {
  ripp_type: string[];
  instrument_type: string[];
  ion_mode: string[];
  ms_type: string[];
};

const emptyFilters: ActiveFilters = {
  ripp_type: [],
  instrument_type: [],
  ion_mode: [],
  ms_type: [],
};

function ContentView() {
  const ref = useRef(null);
  const { width, height } = useContainerDimensions(ref);
  const { backendUrl } = usePropertiesContext();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [allHits, setAllHits] = useState<Hit[]>([]);
  // null = showing all/filtered records; non-null = API search result
  const [searchedHits, setSearchedHits] = useState<Hit[] | null>(null);
  const [reference, setReference] = useState<Peak[]>([]);
  const [sortedHits, setSortedHits] = useState<Hit[] | null>(null);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(emptyFilters);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [propertyFilterOptions, setPropertyFilterOptions] =
    useState<ContentFilterOptions | null>(null);
  const [searchPanelWidth, setSearchPanelWidth] = useState<number>(defaultSearchPanelWidth);

  useEffect(() => {
    if (!backendUrl) return;
    async function loadData() {
      const browseResponse = (await fetchData(
        backendUrl + '/filter/browse',
      )) as RequestResponse<ContentFilterOptions>;

      const browseData =
        browseResponse.status === 'success' && browseResponse.data
          ? (browseResponse.data as ContentFilterOptions)
          : null;
      if (browseData) initFlags(browseData);

      const recordsResponse = await fetchData(backendUrl + '/records');
      if (recordsResponse.status === 'error') {
        setErrorMessage('Failed to load records: ' + recordsResponse.message);
        setIsLoading(false);
        return;
      }
      const raw = recordsResponse.data;
      if (!Array.isArray(raw)) {
        setErrorMessage('Unexpected response format from server.');
        setIsLoading(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loaded: Hit[] = (raw as any[]).map((rec, i) => {
        // Normalize peak values: ChartElement requires peak.id as string/number.
        if (rec.peak?.peak?.values) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          rec.peak.peak.values = rec.peak.peak.values.map((p: any, j: number) => ({
            mz: p.mz,
            intensity: p.intensity,
            rel: p.rel ?? 0,
            id: 'peak-' + (p.id ?? j),
          }));
        }
        return {
          index: i,
          accession: rec.accession as string,
          atomcount: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          record: rec as any,
        };
      });
      setAllHits(loaded);

      // Compute ripp_type options from loaded records (browse API doesn't provide them)
      const rippTypeCounts = new Map<string, number>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loaded.forEach((h) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const classes: string[] = (h.record as any)?.compound?.classes ?? [];
        classes.forEach((c) => rippTypeCounts.set(c, (rippTypeCounts.get(c) ?? 0) + 1));
      });
      const rippTypeOptions: ValueCount[] = Array.from(rippTypeCounts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, count]) => ({ value, count, flag: true }));

      const fullOptions: ContentFilterOptions = {
        ...(browseData ?? { contributor: [], instrument_type: [], ion_mode: [], ms_type: [] }),
        ripp_type: rippTypeOptions,
      };
      setPropertyFilterOptions(fullOptions);
      setIsLoading(false);
    }
    loadData();
  }, [backendUrl]);

  // Client-side filtering of allHits (used when no API search is active)
  const filteredHits = useMemo<Hit[]>(() => {
    let result = allHits;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (h: Hit) => h.record as any;
    if (activeFilters.ripp_type.length > 0)
      result = result.filter((h) =>
        activeFilters.ripp_type.some((t) =>
          (r(h)?.compound?.classes ?? []).includes(t),
        ),
      );
    if (activeFilters.instrument_type.length > 0)
      result = result.filter((h) =>
        activeFilters.instrument_type.includes(r(h)?.acquisition?.instrument_type ?? ''),
      );
    if (activeFilters.ion_mode.length > 0)
      result = result.filter((h) =>
        activeFilters.ion_mode.includes(r(h)?.acquisition?.mass_spectrometry?.ion_mode ?? ''),
      );
    if (activeFilters.ms_type.length > 0)
      result = result.filter((h) =>
        activeFilters.ms_type.includes(r(h)?.acquisition?.mass_spectrometry?.ms_type ?? ''),
      );
    return result;
  }, [allHits, activeFilters]);

  // Base hits: API search results take priority; otherwise client-side filtered
  const baseHits = searchedHits ?? filteredHits;

  useEffect(() => {
    setSortedHits(null);
  }, [baseHits]);

  const displayedHits = sortedHits ?? baseHits;

  // Live property filter changes — instant, no API call
  const handleOnValuesChange = useCallback((formData: SearchFields) => {
    setActiveFilters({
      ripp_type: (formData?.propertyFilterOptions?.ripp_type ?? []) as string[],
      instrument_type: (formData?.propertyFilterOptions?.instrument_type ?? []) as string[],
      ion_mode: (formData?.propertyFilterOptions?.ion_mode ?? []) as string[],
      ms_type: (formData?.propertyFilterOptions?.ms_type ?? []) as string[],
    });
  }, []);

  // Search button click — calls backend API (compound / spectral search)
  const handleOnSubmit = useCallback(
    async (formData: SearchFields) => {
      setIsSearching(true);
      setErrorMessage(null);

      const builtSearchParams = buildSearchParamsFromFormData(formData);

      // Set reference peaks for mirrored chart display
      const peakListStr = (
        formData.spectralSearchFilterOptions?.similarity?.peakList ?? ''
      ).trim();
      if (peakListStr.length > 0) {
        setReference(parsePeakListInputField(peakListStr));
      } else {
        const peakSearchPeaks = formData.spectralSearchFilterOptions?.peaks?.peaks ?? [];
        if (peakSearchPeaks.length > 0) {
          setReference(
            peakSearchPeaks.map((p) => ({
              mz: p.mz,
              intensity: 0,
              rel: 999,
              id: generateID(),
            } as Peak)),
          );
        } else {
          setReference([]);
        }
      }

      const response = (await fetchData(
        backendUrl + '/records/search',
        builtSearchParams,
      )) as RequestResponse<SearchResult>;

      if (response.status === 'error') {
        setErrorMessage('Search failed: ' + response.message);
        setSearchedHits(null);
        setIsSearching(false);
        return;
      }

      const raw: Hit[] = (response.data as SearchResult)?.data ?? [];
      // Map API hits back to pre-loaded records (which have full data + peak values)
      const byAccession = new Map(allHits.map((h) => [h.accession, h]));
      const ranked = raw.map((h, i) => {
        const existing = byAccession.get(h.accession);
        return { ...(existing ?? h), index: i, score: h.score } as Hit;
      });

      setSearchedHits(ranked);
      setIsSearching(false);
    },
    [backendUrl, allHits],
  );

  const searchPanelHeight = useMemo(() => height * 0.9, [height]);

  const handleOnCollapse = useCallback((_collapsed: boolean) => {
    setIsCollapsed(_collapsed);
    setSearchPanelWidth(_collapsed ? collapseButtonWidth : defaultSearchPanelWidth);
  }, []);

  const handleOnSelectSort = useCallback(
    (sortValue: ResultTableSortOption) => {
      setSortedHits(sortHits([...baseHits], sortValue));
    },
    [baseHits],
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

  const insertPlaceholder = useCallback(
    (_e: KeyboardEvent<HTMLElement>, _values: SearchFields) => {},
    [],
  );

  const filterItems = useMemo(
    () =>
      SearchPanelMenuItems({
        propertyFilterOptions,
        insertPlaceholder,
      }),
    [propertyFilterOptions, insertPlaceholder],
  );

  const searchPanel = useMemo(
    () => (
      <CommonSearchPanel
        items={filterItems}
        collapsed={isCollapsed}
        onCollapse={handleOnCollapse}
        propertyFilterOptions={propertyFilterOptions}
        onSubmit={handleOnSubmit}
        onValuesChange={handleOnValuesChange}
        width={searchPanelWidth}
        height={searchPanelHeight}
        initialValues={initialFilterValues}
        disableActiveKeys={true}
        hideSearchButton={false}
      />
    ),
    [
      filterItems,
      isCollapsed,
      handleOnCollapse,
      propertyFilterOptions,
      handleOnSubmit,
      handleOnValuesChange,
      searchPanelWidth,
      searchPanelHeight,
      initialFilterValues,
    ],
  );

  return (
    <Layout
      ref={ref}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        userSelect: 'none',
      }}
    >
      {isLoading || width === 0 ? (
        <Spin size="large" />
      ) : errorMessage && !isSearching ? (
        <ErrorElement message={errorMessage} />
      ) : (
        <Content style={{ width: '100%', height: '100%', backgroundColor: 'white' }}>
          <SearchAndResultPanel
            searchPanel={searchPanel}
            width={width}
            height={searchPanelHeight}
            searchPanelWidth={searchPanelWidth}
            widthOverview={width}
            heightOverview={height}
            hits={displayedHits}
            isRequesting={isSearching}
            reference={reference}
            onSort={handleOnSelectSort}
            onResize={handleOnResize}
          />
        </Content>
      )}
    </Layout>
  );
}

export default ContentView;
