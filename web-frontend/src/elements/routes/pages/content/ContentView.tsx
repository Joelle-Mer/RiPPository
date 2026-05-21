import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useContainerDimensions from '../../../../utils/useContainerDimensions';
import Hit from '../../../../types/Hit';
import ContentFilterOptions from '../../../../types/filterOptions/ContentFilterOtions';
import { Layout } from 'antd';
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
import buildSearchParamsFromFormData from '../../../../utils/buildSearchParamsFromFormData';
import Record from '../../../../types/record/Record';
import RequestResponse from '../../../../types/RequestResponse';

const defaultSearchPanelWidth = 450;

function ContentView() {
  const ref = useRef(null);
  const { width, height } = useContainerDimensions(ref);
  const { backendUrl } = usePropertiesContext();

  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [propertyFilterOptions, setPropertyFilterOptions] =
    useState<ContentFilterOptions | null>(null);
  const [searchPanelWidth, setSearchPanelWidth] = useState<number>(defaultSearchPanelWidth);

  const handleOnFetchContent = useCallback(
    async () => {
      const url = backendUrl + '/filter/browse';
      const response = (await fetchData(url)) as RequestResponse<ContentFilterOptions>;
      if (response.status === 'success' && response.data) {
        initFlags(response.data);
        setPropertyFilterOptions(response.data);
      }
    },
    [backendUrl],
  );

  const handleOnSearch = useCallback(
    async (formData: SearchFields) => {
      setIsSearching(true);
      const builtSearchParams = buildSearchParamsFromFormData(formData);
      const url = backendUrl + '/records';
      const response = await fetchData(url, builtSearchParams);

      if (response.status === 'error') {
        setHits(null);
        setErrorMessage('An error occurred while trying to fetch records.');
      } else {
        const records = (response.data as Record[] | null) ?? [];
        const _hits: Hit[] = records.map((rec, i) => ({
          index: i,
          accession: rec.accession,
          atomcount: 0,
          record: rec,
        }));
        setHits(_hits);
        setErrorMessage(null);
      }
      setIsSearching(false);
    },
    [backendUrl],
  );

  const handleOnSubmit = useCallback(
    async (formData: SearchFields) => {
      await handleOnSearch(formData);
    },
    [handleOnSearch],
  );

  useEffect(() => {
    handleOnFetchContent();
    handleOnSearch({} as SearchFields);
  }, [handleOnFetchContent, handleOnSearch]);

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
        isRequesting={isSearching}
        onSort={handleOnSelectSort}
        onResize={handleOnResize}
      />
    );
  }, [
    propertyFilterOptions, isCollapsed, handleOnCollapse, handleOnSubmit,
    searchPanelWidth, searchPanelHeight, width, height, hits, isSearching,
    handleOnSelectSort, handleOnResize, initialFilterValues,
  ]);

  return (
    <Layout
      ref={ref}
      style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', userSelect: 'none' }}
    >
      {errorMessage && !hits ? (
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
