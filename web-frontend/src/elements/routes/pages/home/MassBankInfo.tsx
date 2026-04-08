import { memo, useMemo } from 'react';
import rippositoryLogo from '../../../../assets/rippository_logo.png';
import { usePropertiesContext } from '../../../../context/properties/properties';

function RiPPositoryInfo() {
  const { homepageIntroText } = usePropertiesContext();

  return useMemo(
    () => (
      <div
        style={{
          width: '100%',
          minHeight: 460,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '70px 40px',
          background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 50%, #faf5ff 100%)',
          position: 'relative',
          overflow: 'hidden',
          userSelect: 'none',
        }}
      >
        {/* Decorative circles */}
        <div style={{
          position: 'absolute', top: -60, right: -60,
          width: 300, height: 300, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(37,99,235,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: -40, left: -40,
          width: 200, height: 200, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
        <img
          src={rippositoryLogo}
          style={{
            height: 200,
            marginBottom: 28,
            filter: 'drop-shadow(0 8px 24px rgba(37,99,235,0.15))',
            objectFit: 'contain',
            position: 'relative',
          }}
          alt="RiPPository logo"
        />
        <p
          style={{
            maxWidth: 640,
            textAlign: 'center',
            fontSize: 17,
            color: '#374151',
            lineHeight: 1.8,
            margin: 0,
            fontWeight: 400,
            position: 'relative',
          }}
        >
          {homepageIntroText}
        </p>
        <p
          style={{
            maxWidth: 580,
            textAlign: 'center',
            fontSize: 14,
            color: '#6b7280',
            lineHeight: 1.7,
            marginTop: 20,
            marginBottom: 0,
            position: 'relative',
          }}
        >
          The database is actively growing. New RiPP records are continuously being added
          and every contribution is greatly appreciated. If you have data to share, visit
          the <strong>Submit</strong> page.
        </p>
        <div style={{
          display: 'flex', gap: 8, marginTop: 32, position: 'relative',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#2563eb' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#10b981' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#8b5cf6' }} />
        </div>
      </div>
    ),
    [homepageIntroText],
  );
}

export default memo(RiPPositoryInfo);
