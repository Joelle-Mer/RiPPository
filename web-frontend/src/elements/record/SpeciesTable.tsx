import Table from '../basic/Table';
import { CSSProperties, useMemo } from 'react';
import Species from '../../types/record/Species';
import LinksTable from './LinksTable';
import { Content } from 'antd/es/layout/layout';
import ExportableContent from '../common/ExportableContent';
import copyTextToClipboard from '../../utils/copyTextToClipboard';
import NotAvailableLabel from '../basic/NotAvailableLabel';

type InputProps = {
  species: Species | undefined;
  width: CSSProperties['width'];
  height: CSSProperties['height'];
};

function SpeciesTable({ species, width, height }: InputProps) {
  return useMemo(() => {
    const columns = [
      {
        title: 'Parameter',
        dataIndex: 'parameter',
        key: 'parameter',
        align: 'center' as const,
      },
      {
        title: 'Value',
        dataIndex: 'value',
        key: 'value',
        align: 'center' as const,
      },
    ];

    const dataSource = [
      {
        key: '1',
        parameter: 'Name',
        value: species?.name ? (
          <ExportableContent
            mode="copy"
            component={species.name}
            title="Copy species name to clipboard"
            onClick={() => copyTextToClipboard('Species Name', species.name)}
          />
        ) : (
          <NotAvailableLabel />
        ),
      },
      {
        key: '2',
        parameter: 'Strain',
        value: species?.strain ? (
          <ExportableContent
            mode="copy"
            component={species.strain}
            title="Copy strain to clipboard"
            onClick={() => copyTextToClipboard('Strain', species.strain!)}
          />
        ) : (
          <NotAvailableLabel />
        ),
      },
    ];

    return (
      <Content
        style={{
          width,
          height,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Table
          tableName="Species Table"
          columns={columns}
          dataSource={dataSource}
          style={{ width, height: 'auto', marginBottom: 10 }}
          enableExport
        />

        {species?.link && species.link.length > 0 && (
          <LinksTable
            links={species.link}
            width={width}
            height="auto"
            title={
              <Content
                style={{
                  width,
                  fontWeight: 'bolder',
                  fontSize: 14,
                  textAlign: 'center',
                }}
              >
                Links
              </Content>
            }
          />
        )}
      </Content>
    );
  }, [height, species, width]);
}

export default SpeciesTable;
