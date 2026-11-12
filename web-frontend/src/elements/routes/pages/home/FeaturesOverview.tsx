import { memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import routes from '../../../../constants/routes';
import { usePropertiesContext } from '../../../../context/properties/properties';

// paths are looked up when drawn: routes imports this page, so they are not set yet at load time
const features = [
  { title: 'Compound Search', desc: 'Search by compound name, class, formula or mass', icon: '🔍', color: '#eff6ff', border: '#bfdbfe', route: 'content' },
  { title: 'Spectral Search', desc: 'Paste a peak list and find the records with the most similar spectra (Spectral Search, in the panel on the left)', icon: '📊', color: '#f0fdf4', border: '#bbf7d0', route: 'content' },
  { title: 'Annotate a Spectrum', desc: 'Upload or paste an MS/MS spectrum, read amino acid chains from the gaps between peaks, and compare it with known RiPP structures and the closest spectra', icon: '🧬', color: '#f5f3ff', border: '#ddd6fe', route: 'annotate' },
];

function FeaturesOverview() {
  const { baseUrl } = usePropertiesContext();
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
          flexWrap: 'wrap',
          gap: 20,
          width: '100%',
          maxWidth: 980,
          justifyContent: 'center',
        }}
      >
        {features.map((f) => (
          <Link
            key={f.title}
            to={baseUrl + '/' + routes[f.route].path}
            style={{
              flex: '1 1 260px',
              maxWidth: 310,
              textDecoration: 'none',
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
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
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
          </Link>
        ))}
      </div>
    </div>
  ), [baseUrl]);
}

export default memo(FeaturesOverview);
