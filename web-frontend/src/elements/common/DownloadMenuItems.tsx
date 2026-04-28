import { MenuProps } from 'antd';
import DownloadOptionLabel from './DownloadOptionLabel';
import DownloadFormat from '../../types/DownloadFormat';

type InputProps = {
  onDownload: (format: DownloadFormat) => void;
};

function DownloadMenuItems({ onDownload }: InputProps) {
  const items: MenuProps['items'] = [
    {
      key: 'json_download',
      label: <DownloadOptionLabel label="JSON" format="json" onDownload={onDownload} />,
    },
    {
      key: 'mgf_download',
      label: <DownloadOptionLabel label="MGF" format="mgf" onDownload={onDownload} />,
    },
  ];

  return items;
}

export default DownloadMenuItems;
