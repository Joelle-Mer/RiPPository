import Hit from '../../types/Hit';
import Peak from '../../types/peak/Peak';

import { memo, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePropertiesContext } from '../../context/properties/properties';
import routes from '../../constants/routes';
import { Table } from 'antd';
import ResultTableDataType from '../../types/ResultTableDataType';
import ResultLink from './ResultLink';
import Chart from '../basic/Chart';
import StructureView from '../basic/StructureView';
import { Content } from 'antd/es/layout/layout';

type InputProps = {
  reference?: Peak[];
  hits: Hit[];
  height: number;
  onDoubleClick: (slideIndex: number) => void;
  rowHeight?: number;
  chartWidth?: number;
  imageWidth?: number;
};

function ResultTable({
  reference,
  hits,
  height,
  onDoubleClick,
  rowHeight = 100,
  chartWidth = 200,
  imageWidth = 200,
}: InputProps) {
  const navigate = useNavigate();
  const { baseUrl, frontendUrl } = usePropertiesContext();
  const buildChart = useCallback(
    (hit: Hit) =>
      reference && reference.length > 0 ? (
        <Content style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Chart
            peakData={reference}
            peakData2={(hit.record ? hit.record.peak.peak.values : []) as Peak[]}
            width={chartWidth} height={rowHeight} disableZoom disableLabels disableOnHover
          />
        </Content>
      ) : (
        <Content style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Chart
            peakData={(hit.record ? hit.record.peak.peak.values : []) as Peak[]}
            width={chartWidth} height={rowHeight} disableZoom disableLabels disableOnHover
          />
        </Content>
      ),
    [chartWidth, reference, rowHeight],
  );

  const buildStructure = useCallback(
    (smiles: string) => (
      <Content style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <StructureView smiles={smiles} imageWidth={imageWidth} imageHeight={rowHeight} disableExport />
      </Content>
    ),
    [imageWidth, rowHeight],
  );

  const dataSource: ResultTableDataType[] = useMemo(() => {
    const rows: ResultTableDataType[] = [];
    hits.forEach((hit) => {
      const rippType =
        (hit.record?.compound?.classes && hit.record.compound.classes.length > 0)
          ? hit.record.compound.classes[0]
          : 'N/A';
      const bioactivityComment = hit.record?.comments?.find(
        (c) => c.subtag?.toUpperCase() === 'BIOACTIVITY',
      );
      const bioactivity = bioactivityComment?.value ?? 'N/A';
      const row: ResultTableDataType = {
        key: 'result-table-row_' + hit.index + '_' + hit.score,
        accessionRaw: hit.accession,
        index: hit.index + 1,
        score: hit.score ? hit.score.toFixed(4) : undefined,
        accession: hit.record ? <ResultLink hit={hit} /> : 'No data',
        title: hit.record ? hit.record.title : 'No data',
        rippType,
        bioactivity,
        chart: hit.record ? buildChart(hit) : null,
        structure: hit.record ? buildStructure(hit.record.compound.smiles) : null,
      };
      rows.push(row);
    });
    return rows;
  }, [buildChart, buildStructure, hits]);

  const handleOnRowClick = useCallback(
    (record: ResultTableDataType) => ({
      onClick: () => {
        const url = frontendUrl + baseUrl + '/' + routes.accession.path + '?id=' + record.accessionRaw;
        navigate(url.replace(frontendUrl, ''));
      },
      style: { cursor: 'pointer' },
    }),
    [navigate, baseUrl, frontendUrl],
  );

  const columns = useMemo(() => {
    const defaultColumns = [
      {
        title: 'Accession',
        dataIndex: 'accession',
        key: 'accession',
        align: 'center' as const,
        sorter: (a: ResultTableDataType, b: ResultTableDataType) => a.accessionRaw.localeCompare(b.accessionRaw),
        showSorterTooltip: false,
      },
      {
        title: 'Title',
        dataIndex: 'title',
        key: 'title',
        align: 'center' as const,
        sorter: (a: ResultTableDataType, b: ResultTableDataType) => a.title.localeCompare(b.title),
        showSorterTooltip: false,
      },
      {
        title: 'RiPP Type',
        dataIndex: 'rippType',
        key: 'rippType',
        align: 'center' as const,
        width: 140,
        sorter: (a: ResultTableDataType, b: ResultTableDataType) => a.rippType.localeCompare(b.rippType),
        showSorterTooltip: false,
      },
      {
        title: 'Bioactivity',
        dataIndex: 'bioactivity',
        key: 'bioactivity',
        align: 'center' as const,
        width: 140,
        sorter: (a: ResultTableDataType, b: ResultTableDataType) => a.bioactivity.localeCompare(b.bioactivity),
        showSorterTooltip: false,
      },
      {
        title: 'Chart',
        dataIndex: 'chart',
        key: 'chart',
      },
      {
        title: 'Structure',
        dataIndex: 'structure',
        key: 'structure',
      },
    ];

    const _columns = [...defaultColumns];

    if (hits.find((hit) => hit.score !== undefined)) {
      _columns.splice(0, 0, {
        title: 'Score',
        dataIndex: 'score',
        key: 'score',
        align: 'center' as const,
        width: 100,
        sorter: (a: ResultTableDataType, b: ResultTableDataType) => Number(a.score ?? 0) - Number(b.score ?? 0),
        showSorterTooltip: false,
      });
    }

    return _columns;
  }, [hits]);

  return (
    <Table<ResultTableDataType>
      style={{ width: '100%', height, overflowY: 'auto', overflowX: 'hidden' }}
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      onRow={handleOnRowClick}
      sticky
    />
  );
}

export default memo(ResultTable);
