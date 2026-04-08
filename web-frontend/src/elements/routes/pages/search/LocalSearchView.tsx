import { useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Empty, Table, Tag, Typography } from 'antd';
import { Content } from 'antd/es/layout/layout';
import { SUBMISSIONS_KEY, type RiPPSubmission } from '../submit/SubmitView';
import routes from '../../../../constants/routes';
import { usePropertiesContext } from '../../../../context/properties/properties';

const { Title, Text } = Typography;

function LocalSearchView() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { baseUrl } = usePropertiesContext();

  const query = (searchParams.get('compound_name') ?? searchParams.get('q') ?? '').trim().toLowerCase();

  const results = useMemo<RiPPSubmission[]>(() => {
    if (!query) return [];
    try {
      const all: RiPPSubmission[] = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) ?? '[]');
      return all.filter(s =>
        s.compoundName?.toLowerCase().includes(query) ||
        s.compoundClass?.toLowerCase().includes(query) ||
        s.formula?.toLowerCase().includes(query) ||
        s.recordTitle?.toLowerCase().includes(query) ||
        s.accession?.toLowerCase().includes(query),
      );
    } catch { return []; }
  }, [query]);

  const columns = [
    {
      title: 'Accession',
      dataIndex: 'accession',
      width: 160,
      render: (acc: string) => (
        <Button
          type="link"
          style={{ padding: 0 }}
          onClick={() =>
            navigate({ pathname: baseUrl + '/' + routes.accession.path, search: `?id=${acc}` })
          }
        >
          {acc}
        </Button>
      ),
    },
    { title: 'Compound name', dataIndex: 'compoundName', ellipsis: true },
    { title: 'Class', dataIndex: 'compoundClass', width: 180, ellipsis: true },
    { title: 'Formula', dataIndex: 'formula', width: 120 },
    {
      title: 'Exact mass',
      dataIndex: 'exactMass',
      width: 110,
      render: (v: number | null) => v?.toFixed(4) ?? 'N/A',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (v: RiPPSubmission['status']) => (
        <Tag color={v === 'Approved' ? 'green' : v === 'Rejected' ? 'red' : 'orange'}>{v}</Tag>
      ),
    },
  ];

  return (
    <Content style={{ width: '100%', height: '100%', overflowY: 'auto', backgroundColor: '#f8fafc' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
        <Title level={3} style={{ marginBottom: 4 }}>Search results</Title>
        {query ? (
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            {results.length} record{results.length !== 1 ? 's' : ''} matching <Text strong>"{query}"</Text>
          </Text>
        ) : (
          <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
            Enter a compound name, class, or formula in the search bar above.
          </Text>
        )}

        {results.length === 0 && query ? (
          <Empty description={`No records found for "${query}"`} />
        ) : (
          <Table
            size="small"
            dataSource={results.map(r => ({ ...r, key: r.accession }))}
            columns={columns}
            pagination={{ pageSize: 25, showTotal: (t) => `${t} records` }}
          />
        )}
      </div>
    </Content>
  );
}

export default LocalSearchView;
