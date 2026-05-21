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

function ContentView() {
  const ref = useRef(null);
  const { width, height } = useContainerDimensions(ref);
  const { backendUrl } = usePropertiesContext();

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [allHits, setAllHits] = useState<Hit[]>([]);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [propertyFilterOptions, setPropertyFilterOptions] =
    useState<ContentFilterOptions | null>(null);
  const [searchPanelWidth, setSearchPanelWidth] = useState<number>(defaultSearchPanelWidth);

  useEffect(() => {
    async function loadData() {
      setIsLoading(true);

      // Fetch filter options
      const browseResponse = (await fetchData(backendUrl + '/filter/browse')) as RequestResponse<ContentFilterOptions>;
      if (browseResponse.status === 'success' && browseResponse.data) {
        initFlags(browseResponse.data);
        setPropertyFilterOptions(browseResponse.data);
      }

      // Fetch all records
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
      setHits(loaded);
      setIsLoading(false);
    }
    loadData();
  }, [backendUrl]);

  const handleOnSubmit = useCallback(
    (formData: SearchFields) => {
      const rippSelected = (formData?.propertyFilterOptions?.ripp_type ?? []) as string[];
      const instrSelected = (formData?.propertyFilterOptions?.instrument_type ?? []) as string[];
      const ionSelected = (formData?.propertyFilterOptions?.ion_mode ?? []) as string[];
      const msSelected = (formData?.propertyFilterOptions?.ms_type ?? []) as string[];

      let filtered = allHits;
      if (rippSelected.length > 0)
        filtered = filtered.filter((h) => rippSelected.includes(h.record?.compound?.classes?.[0] ?? ''));
      if (instrSelected.length > 0)
        filtered = filtered.filter((h) => instrSelected.includes(h.record?.acquisition?.instrument_type ?? ''));
      if (ionSelected.length > 0)
        filtered = filtered.filter((h) => ionSelected.includes(h.record?.acquisition?.mass_spectrometry?.ion_mode ?? ''));
      if (msSelected.length > 0)
        filtered = filtered.filter((h) => msSelected.includes(h.record?.acquisition?.mass_spectrometry?.ms_type ?? ''));

      setHits(filtered);
    },
    [allHits],
  );

  const searchPanelHeight = useMemo(() => height * 0.9, [height]);

  const handleOnCollapse = useCallback((_collapsed: boolean) => {
    setIsCollapsed(_collapsed);
    setSearchPanelWidth(_collapsed ? collapseButtonWidth : defaultSearchPanelWidth);
  }, []);

  const handleOnSelectSort = useCallback(
    (sortValue: ResultTableSortOption) => {
      setHits((prev) => (prev ? sortHits(prev, sortValue) : null));
    },
    [],
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

  const searchAndResultPanel = useMemo(() => {
    const filterItems = PropertyFilterOptionsMenuItems({ propertyFilterOptions, showCounts: true });

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
        isRequesting={false}
        onSort={handleOnSelectSort}
        onResize={handleOnResize}
      />
    );
  }, [
    propertyFilterOptions, isCollapsed, handleOnCollapse, handleOnSubmit,
    searchPanelWidth, searchPanelHeight, width, height, hits,
    handleOnSelectSort, handleOnResize, initialFilterValues,
  ]);

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
          {searchAndResultPanel}
        </Content>
      )}
    </Layout>
  );
}

export default ContentView;
