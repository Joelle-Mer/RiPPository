import { Layout } from 'antd';
import { usePropertiesContext } from '../../context/properties/properties';
import { CSSProperties, MouseEvent, useCallback, useMemo } from 'react';

const { Footer: FooterAntD } = Layout;

type InputProps = {
  height: CSSProperties['height'];
  enableDataPrivacyButton?: boolean;
  onClickDataPrivacy?: () => void;
};

function Footer({
  height,
  enableDataPrivacyButton = false,
  onClickDataPrivacy = () => {},
}: InputProps) {
  const { version } = usePropertiesContext();

  const handleOnClickDataPrivacy = useCallback(
    (e: MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onClickDataPrivacy();
    },
    [onClickDataPrivacy],
  );

  return useMemo(
    () => (
      <FooterAntD
        style={{
          width: '100%',
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: '#f8fafc',
          borderTop: '1px solid #e5e7eb',
          padding: '0 32px',
        }}
      >
        <span style={{ color: '#6b7280', fontSize: 13 }}>
          © 2025 RiPPository, Leiden University &amp; Wageningen University &amp; Research
        </span>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>
          v{version}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {enableDataPrivacyButton && (
            <a
              href="#"
              onClick={handleOnClickDataPrivacy}
              style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}
            >
              Data Privacy
            </a>
          )}
          <a
            href="https://github.com/Joelle-Mer/RiPPository"
            target="_blank"
            title="Find us on GitHub"
            style={{ display: 'flex', alignItems: 'center' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="#6b7280" viewBox="0 0 16 16">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
            </svg>
          </a>
        </div>
      </FooterAntD>
    ),
    [enableDataPrivacyButton, handleOnClickDataPrivacy, height, version],
  );
}

export default Footer;
