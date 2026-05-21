import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useContainerDimensions from '../../../../utils/useContainerDimensions';
import Hit from '../../../../types/Hit';
import ContentFilterOptions from '../../../../types/filterOptions/ContentFilterOtions';
import { Layout, Spin } from 'antd';
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
import fetchData from '../../../../utils/request/fetchData';
import initFlags from '../../../../utils/initFlags';
import { usePropertiesContext } from '../../../../context/properties/properties';
import Record from '../../../../types/record/Record';
import RequestResponse from '../../../../types/RequestResponse';

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
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [allHits, setAllHits] = useState<Hit[]>([]);
  const [sortedHits, setSortedHits] = useState<Hit[] | null>(null);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(emptyFilters);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [propertyFilterOptions, setPropertyFilterOptions] =
    useState<ContentFilterOptions | null>(null);
  const [searchPanelWidth, setSearchPanelWidth] = useState<number>(defaultSearchPanelWidth);

  useEffect(() => {
    async function loadData() {
      const browseResponse = (await fetchData(backendUrl + '/filter/browse')) as RequestResponse<ContentFilterOptions>;
      if (browseResponse.status === 'success' && browseResponse.data) {
        initFlags(browseResponse.data);
        setPropertyFilterOptions(browseResponse.data);
      }

      const recordsResponse = await fetchData(backendUrl + '/records');
      if (recordsResponse.status === 'error') {
        setErrorMessage('Failed to load records.');
        setIsLoading(false);
        return;
      }
      const records = (recordsResponse.data as Record[] | null) ?? [];
      const loaded: Hit[] = records.map((rec, i) => ({
        index: i,
        accession: rec.accession,
        atomcount: 0,
        record: rec,
      }));
      setAllHits(loaded);
      setIsLoading(false);
    }
    loadData();
  }, [backendUrl]);

  // Derive filtered hits from allHits + activeFilters — no setState, no loops
  const filteredHits = useMemo<Hit[]>(() => {
    let result = allHits;
    if (activeFilters.ripp_type.length > 0)
      result = result.filter((h) => activeFilters.ripp_type.includes(h.record?.compound?.classes?.[0] ?? ''));
    if (activeFilters.instrument_type.length > 0)
      result = result.filter((h) => activeFilters.instrument_type.includes(h.record?.acquisition?.instrument_type ?? ''));
    if (activeFilters.ion_mode.length > 0)
      result = result.filter((h) => activeFilters.ion_mode.includes(h.record?.acquisition?.mass_spectrometry?.ion_mode ?? ''));
    if (activeFilters.ms_type.length > 0)
      result = result.filter((h) => activeFilters.ms_type.includes(h.record?.acquisition?.mass_spectrometry?.ms_type ?? ''));
    return result;
  }, [allHits, activeFilters]);

  // sortedHits overrides filteredHits when the user sorts; reset when filteredHits changes
  useEffect(() => {
    setSortedHits(null);
  }, [filteredHits]);

  const displayedHits = sortedHits ?? filteredHits;

  const handleOnSubmit = useCallback(
    (formData: SearchFields) => {
      setActiveFilters({
        ripp_type: (formData?.propertyFilterOptions?.ripp_type ?? []) as string[],
        instrument_type: (formData?.propertyFilterOptions?.instrument_type ?? []) as string[],
        ion_mode: (formData?.propertyFilterOptions?.ion_mode ?? []) as string[],
        ms_type: (formData?.propertyFilterOptions?.ms_type ?? []) as string[],
      });
    },
    [],
  );

  const searchPanelHeight = useMemo(() => height * 0.9, [height]);

  const handleOnCollapse = useCallback((_collapsed: boolean) => {
    setIsCollapsed(_collapsed);
    setSearchPanelWidth(_collapsed ? collapseButtonWidth : defaultSearchPanelWidth);
  }, []);

  const handleOnSelectSort = useCallback(
    (sortValue: ResultTableSortOption) => {
      setSortedHits(sortHits([...filteredHits], sortValue));
    },
    [filteredHits],
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

  const filterItems = useMemo(
    () => PropertyFilterOptionsMenuItems({ propertyFilterOptions, showCounts: true }),
    [propertyFilterOptions],
  );

  const searchPanel = useMemo(() => (
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
  ), [filterItems, isCollapsed, handleOnCollapse, propertyFilterOptions, handleOnSubmit,
      searchPanelWidth, searchPanelHeight, initialFilterValues]);

  return (
    <Layout
      ref={ref}
      style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', userSelect: 'none' }}
    >
      {isLoading ? (
        <Spin size="large" />
      ) : errorMessage ? (
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
            isRequesting={false}
            onSort={handleOnSelectSort}
            onResize={handleOnResize}
          />
        </Content>
      )}
    </Layout>
  );
}

export default ContentView;
