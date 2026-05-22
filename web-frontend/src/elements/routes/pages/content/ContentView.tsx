import { useEffect, useState } from 'react';
import { Layout, Spin, Table } from 'antd';
import { usePropertiesContext } from '../../../../context/properties/properties';
import fetchData from '../../../../utils/request/fetchData';
import { useNavigate } from 'react-router-dom';
import routes from '../../../../constants/routes';

type ContentRecord = {
  accession: string;
  title: string;
  compound?: { classes?: string[]; mass?: number };
};

function ContentView() {
  const { backendUrl, baseUrl } = usePropertiesContext();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [records, setRecords] = useState<ContentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backendUrl) return;
    fetchData(backendUrl + '/records').then((response) => {
      if (response.status === 'error') {
        setError('Failed to load: ' + response.message);
      } else {
        const data = response.data;
        if (Array.isArray(data)) {
          setRecords(data as ContentRecord[]);
        } else {
          setError('Unexpected response format: ' + JSON.stringify(data)?.slice(0, 200));
        }
      }
      setIsLoading(false);
    });
  }, [backendUrl]);

  const columns = [
    { title: 'Accession', dataIndex: 'accession', key: 'accession' },
    { title: 'Title', dataIndex: 'title', key: 'title' },
    {
      title: 'RiPP Type',
      key: 'rippType',
      render: (_: unknown, r: ContentRecord) => r.compound?.classes?.[0] ?? '—',
    },
    {
      title: 'Mass (Da)',
      key: 'mass',
      render: (_: unknown, r: ContentRecord) => {
        const m = r.compound?.mass;
        return m != null && m !== 0 ? m.toFixed(4) : '—';
      },
    },
  ];

  return (
    <Layout style={{ width: '100%', height: '100%', padding: 24 }}>
      {isLoading ? (
        <Spin size="large" style={{ margin: 'auto' }} />
      ) : error ? (
        <div style={{ color: 'red' }}>{error}</div>
      ) : (
        <Table
          dataSource={records.map((r, i) => ({ ...r, key: i }))}
          columns={columns}
          onRow={(r) => ({
            style: { cursor: 'pointer' },
            onClick: () =>
              navigate(baseUrl + '/' + routes.accession.path + '?id=' + r.accession),
          })}
          pagination={false}
        />
      )}
    </Layout>
  );
}

export default ContentView;
