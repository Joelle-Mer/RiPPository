import { memo, useMemo } from 'react';

const features = [
  { title: 'Compound Search', desc: 'Search by compound name, formula or mass', icon: '🔍', color: '#eff6ff', border: '#bfdbfe' },
  { title: 'Spectral Search', desc: 'Find records by mass spectral similarity', icon: '📊', color: '#f0fdf4', border: '#bbf7d0' },
];

function FeaturesOverview() {
  return useMemo(() => (
    <div
      style={{
        width: '100%',
        padding: '52px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        backgroundColor: '#ffffff',
      }}
    >
      <h2 style={{ fontSize: 24, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
        Key Features
      </h2>
      <p style={{ color: '#6b7280', fontSize: 15, marginBottom: 40, textAlign: 'center' }}>
        Everything you need to access and explore RiPP spectral data
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 20,
          width: '100%',
          maxWidth: 640,
          justifyContent: 'center',
        }}
      >
        {features.map((f) => (
          <div
            key={f.title}
            style={{
              backgroundColor: f.color,
              border: `1px solid ${f.border}`,
              borderRadius: 14,
              padding: '24px 28px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 16,
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: 28, flexShrink: 0 }}>{f.icon}</span>
            <div>
              <div style={{ fontWeight: 700, color: '#111827', fontSize: 15, marginBottom: 6 }}>
                {f.title}
              </div>
              <div style={{ color: '#6b7280', fontSize: 13, lineHeight: 1.6 }}>
                {f.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  ), []);
}

export default memo(FeaturesOverview);
