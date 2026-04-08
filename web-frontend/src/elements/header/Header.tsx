import routes from '../../constants/routes';
import { useLocation } from 'react-router-dom';
import { usePropertiesContext } from '../../context/properties/properties';
import { CSSProperties, useMemo } from 'react';
import logo from '../../assets/rippository_logo.png';
import HeaderTemplate from '../basic/HeaderTemplate';
import MenuItem from '../../types/MenuItem';

const backgroundColor: CSSProperties['backgroundColor'] = '#ffffff';
const activeColor = '#2563eb';
const textColor = '#374151';

type InputProps = {
  height: CSSProperties['height'];
};

function Header({ height }: InputProps) {
  const location = useLocation();
  const { baseUrl } = usePropertiesContext();

  const logoLink: MenuItem = useMemo(() => {
    return {
      key: 'logo-link',
      label: (
        <a href={baseUrl + '/'} target="_self" style={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <img
            src={logo}
            alt="RiPPository"
            style={{
              height: typeof height === 'number' ? height - 20 : `calc(${height} - 20px)`,
              padding: '4px 0',
              objectFit: 'contain',
            }}
          />
        </a>
      ),
    };
  }, [baseUrl, height]);

  const routeLinks: MenuItem[] = useMemo(
    () =>
      Object.values(routes)
        .filter(
          (route) =>
            route.id === routes.content.id ||
            route.id === routes.more.id ||
            route.id === routes.submit.id,
        )
        .map((route) => {
          const path = baseUrl + '/' + route.path;
          const isActive = location.pathname.startsWith(path) && path !== baseUrl + '/';
          return {
            key: path,
            label: (
              <a
                href={path}
                target="_self"
                style={{
                  color: isActive ? activeColor : textColor,
                  fontWeight: isActive ? 600 : 500,
                  fontSize: 14,
                  letterSpacing: '0.2px',
                  borderBottom: isActive ? `2px solid ${activeColor}` : '2px solid transparent',
                  paddingBottom: 2,
                  transition: 'all 0.2s',
                }}
              >
                {route.label}
              </a>
            ),
          } as MenuItem;
        }) as MenuItem[],
    [baseUrl, height, location.pathname],
  );

  return useMemo(() => {
    const items = [logoLink, ...routeLinks];
    return <HeaderTemplate height={height} items={items} backgroundColor={backgroundColor} />;
  }, [height, logoLink, routeLinks]);
}

export default Header;
