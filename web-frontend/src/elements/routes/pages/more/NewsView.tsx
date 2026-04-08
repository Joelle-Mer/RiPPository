import { Layout } from 'antd';
import { Content } from 'antd/es/layout/layout';

function NewsView() {
  return (
    <Layout style={{ width: '100%', height: '100%' }}>
      <Content
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 60,
        }}
      >
        <div
          style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            backgroundColor: '#e8f0fe',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            fontSize: 28,
            marginBottom: 20,
          }}
        >
          📰
        </div>
        <h2 style={{ color: '#0f2d52', fontWeight: 600, marginBottom: 8 }}>
          News Coming Soon
        </h2>
        <p style={{ color: '#64748b', textAlign: 'center', maxWidth: 400 }}>
          Updates and announcements about RiPPository will be posted here.
        </p>
      </Content>
    </Layout>
  );
}

export default NewsView;
