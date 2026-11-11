import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default () => {
  return defineConfig({
    base: '',
    plugins: [react()],
    server: {
      proxy: {
        '/annotate-api': {
          target: 'http://127.0.0.1:8090',
          rewrite: (path) => path.replace(/^\/annotate-api/, ''),
        },
      },
    },
    ssr: {
      noExternal: [
        'antd',
        '@ant-design/cssinjs',
        '@ant-design/icons',
        /^rc-.*/, // All rc-* packages used by antd
        /^@rc-component\/.*/, // All @rc-component/* packages used by antd
      ],
    },
  });
};
