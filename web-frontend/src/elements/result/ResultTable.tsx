import Hit from '../../types/Hit';
import Peak from '../../types/peak/Peak';

import { memo, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePropertiesContext } from '../../context/properties/properties';
import routes from '../../constants/routes';
import { Table } from 'antd';
import type { ColumnType } from 'antd/es/table';
import ResultTableDataType from '../../types/ResultTableDataType';
import ResultLink from './ResultLink';
import Chart from '../basic/Chart';
import StructureView from '../basic/StructureView';
import { Content } from 'antd/es/layout/layout';
import React from 'react';

// ── Resizable header cell ────────────────────────────────────────────────────
type ResizableTitleProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  onResize?: (newWidth: number) => void;
  width?: number;
};

function ResizableTitle({ onResize, width, children, style, ...rest }: ResizableTitleProps) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onResize || width == null) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = width;

      const onMove = (mv: MouseEvent) => {
        onResize(Math.max(40, startW + mv.clientX - startX));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [onResize, width],
  );

  return (
    <th
      {...rest}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
    >
      {children}
      {onResize && (
        <div
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 6,
            cursor: 'col-resize',
            zIndex: 1,
          }}
        />
      )}
    </th>
  );
}

// ── Default column widths ────────────────────────────────────────────────────
const DEFAULT_WIDTHS: Record<string, number> = {
  score:      80,
  accession:  130,
  title:      200,
  rippType:   140,
  mass:       110,
  bioactivity:140,
  chart:      260,
  structure:  260,
};

// ── Main component ───────────────────────────────────────────────────────────
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

  const [colWidths, setColWidths] = useState<Record<string, number>>({ ...DEFAULT_WIDTHS });

  const handleResize = useCallback(
    (key: string) => (newWidth: number) => {
      setColWidths((prev) => ({ ...prev, [key]: newWidth }));
    },
    [],
  );

  const buildChart = useCallback(
    (hit: Hit) =>
      reference && reference.length > 0 ? (
        <Content style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Chart
            peakData={reference}
            peakData2={(hit.record ? hit.record.peak.peak.values : []) as Peak[]}
            width={colWidths.chart ?? chartWidth} height={rowHeight} disableZoom disableLabels disableOnHover
          />
        </Content>
      ) : (
        <Content style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Chart
            peakData={(hit.record ? hit.record.peak.peak.values : []) as Peak[]}
            width={colWidths.chart ?? chartWidth} height={rowHeight} disableZoom disableLabels disableOnHover
          />
        </Content>
      ),
    [colWidths.chart, chartWidth, reference, rowHeight],
  );

  const buildStructure = useCallback(
    (smiles: string) => (
      <Content style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <StructureView smiles={smiles} imageWidth={colWidths.structure ?? imageWidth} imageHeight={rowHeight} disableExport />
      </Content>
    ),
    [colWidths.structure, imageWidth, rowHeight],
  );

  const dataSource: ResultTableDataType[] = useMemo(() => {
    const rows: ResultTableDataType[] = [];
    hits.forEach((hit) => {
      const fullClass =
        hit.record?.compound?.classes && hit.record.compound.classes.length > 0
          ? hit.record.compound.classes[0]
          : '';
      const rippIdx = fullClass.split('; ').indexOf('RiPP');
      const rippTypeParts = fullClass.split('; ');
      const rippType =
        rippIdx >= 0 && rippIdx + 1 < rippTypeParts.length
          ? rippTypeParts[rippIdx + 1]
          : fullClass || 'N/A';
      // Handle two storage formats:
      // 1. Correct: {subtag: "BIOACTIVITY", value: "Grazer; ..."}
      // 2. Legacy:  {subtag: "", value: "BIOACTIVITY Grazer; ..."}
      const bioactivityComment = hit.record?.comments?.find(
        (c) =>
          c.subtag?.toUpperCase() === 'BIOACTIVITY' ||
          c.value?.toUpperCase().startsWith('BIOACTIVITY '),
      );
      const bioactivityFull = bioactivityComment
        ? bioactivityComment.subtag
          ? bioactivityComment.value
          : bioactivityComment.value.replace(/^BIOACTIVITY\s+/i, '')
        : 'N/A';
      const bioactivity = bioactivityFull === 'N/A'
        ? 'N/A'
        : bioactivityFull.split(';')[0].trim();
      const row: ResultTableDataType = {
        key: 'result-table-row_' + hit.index + '_' + hit.score,
        accessionRaw: hit.accession,
        index: hit.index + 1,
        score: hit.score ? hit.score.toFixed(4) : undefined,
        accession: hit.record ? <ResultLink hit={hit} /> : 'No data',
        title: hit.record ? hit.record.title : 'No data',
        rippType,
        mass: hit.record?.compound?.mass ?? null,
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

  const makeCol = useCallback(
    (key: string, extra: Partial<ColumnType<ResultTableDataType>>): ColumnType<ResultTableDataType> => ({
      ...extra,
      key,
      width: colWidths[key] ?? DEFAULT_WIDTHS[key],
      onHeaderCell: () => ({
        width: colWidths[key] ?? DEFAULT_WIDTHS[key],
        onResize: handleResize(key),
      }),
    }),
    [colWidths, handleResize],
  );

  const columns: ColumnType<ResultTableDataType>[] = useMemo(() => {
    const defaultColumns: ColumnType<ResultTableDataType>[] = [
      makeCol('accession', {
        title: 'Accession',
        dataIndex: 'accession',
        align: 'center',
        sorter: (a, b) => a.accessionRaw.localeCompare(b.accessionRaw),
        showSorterTooltip: false,
      }),
      makeCol('title', {
        title: 'Title',
        dataIndex: 'title',
        align: 'center',
        sorter: (a, b) => a.title.localeCompare(b.title),
        showSorterTooltip: false,
      }),
      makeCol('rippType', {
        title: 'RiPP Type',
        dataIndex: 'rippType',
        align: 'center',
        sorter: (a, b) => a.rippType.localeCompare(b.rippType),
        showSorterTooltip: false,
      }),
      makeCol('mass', {
        title: 'Mass (Da)',
        dataIndex: 'mass',
        align: 'center',
        render: (val: number | null) => (val != null && val > 0 ? val.toFixed(4) : '—'),
        sorter: (a, b) => (a.mass ?? 0) - (b.mass ?? 0),
        showSorterTooltip: false,
      }),
      makeCol('bioactivity', {
        title: 'Bioactivity',
        dataIndex: 'bioactivity',
        align: 'center',
        sorter: (a, b) => a.bioactivity.localeCompare(b.bioactivity),
        showSorterTooltip: false,
      }),
      makeCol('chart', { title: 'Chart', dataIndex: 'chart' }),
      makeCol('structure', { title: 'Structure', dataIndex: 'structure' }),
    ];

    if (hits.find((hit) => hit.score !== undefined)) {
      defaultColumns.unshift(
        makeCol('score', {
          title: 'Score',
          dataIndex: 'score',
          align: 'center',
          sorter: (a, b) => Number(a.score ?? 0) - Number(b.score ?? 0),
          showSorterTooltip: false,
        }),
      );
    }

    return defaultColumns;
  }, [hits, makeCol]);

  return (
    <Table<ResultTableDataType>
      style={{ width: '100%', height, overflowY: 'auto', overflowX: 'hidden' }}
      columns={columns}
      dataSource={dataSource}
      pagination={false}
      onRow={handleOnRowClick}
      components={{ header: { cell: ResizableTitle } }}
      scroll={{ x: 'max-content' }}
      sticky
    />
  );
}

export default memo(ResultTable);
