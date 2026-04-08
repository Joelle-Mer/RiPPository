import { Form } from 'antd';
import FilterTable from '../../../../../common/FilterTable';
import SearchFields from '../../../../../../types/filterOptions/SearchFields';
import ContentFilterOptions from '../../../../../../types/filterOptions/ContentFilterOtions';

type InputProps = {
  propertyFilterOptions: ContentFilterOptions | null;
  showCounts?: boolean;
};

function PropertyFilterOptionsMenuItems({
  propertyFilterOptions,
  showCounts = false,
}: InputProps) {
  return [
    {
      key: 'propertyFilterOptions.ripp_type',
      label: 'Type of RiPP',
      children: [
        {
          key: 'rippType',
          style: { width: '100%', marginLeft: 0 },
          label: (
            <Form.Item<SearchFields>
              name={['propertyFilterOptions', 'ripp_type']}
              rules={[{ required: false }]}
              style={{ width: '100%', marginBottom: 0 }}
            >
              <FilterTable
                filterOptions={propertyFilterOptions?.ripp_type ?? []}
                filterName="propertyFilterOptions"
                label="ripp_type"
                showCounts={showCounts}
              />
            </Form.Item>
          ),
        },
      ],
    },
    {
      key: 'propertyFilterOptions.instrument_type',
      label: 'Instrument Type',
      children: [
        {
          key: 'intrumentType',
          style: { width: '100%', marginLeft: 0 },
          label: (
            <Form.Item<SearchFields>
              name={['propertyFilterOptions', 'instrument_type']}
              rules={[{ required: false }]}
              style={{ width: '100%', marginBottom: 0 }}
            >
              <FilterTable
                filterOptions={propertyFilterOptions?.instrument_type ?? []}
                filterName="propertyFilterOptions"
                label="instrument_type"
                showCounts={showCounts}
              />
            </Form.Item>
          ),
        },
      ],
    },
    {
      key: 'propertyFilterOptions.ms_type',
      label: 'MS Type',
      children: [
        {
          key: 'msType',
          style: { width: '100%', marginLeft: 0 },
          label: (
            <Form.Item<SearchFields>
              name={['propertyFilterOptions', 'ms_type']}
              rules={[{ required: false }]}
              style={{ width: '100%', marginBottom: 0 }}
            >
              <FilterTable
                filterOptions={propertyFilterOptions?.ms_type ?? []}
                filterName="propertyFilterOptions"
                label="ms_type"
                showCounts={showCounts}
              />
            </Form.Item>
          ),
        },
      ],
    },
    {
      key: 'propertyFilterOptions.ion_mode',
      label: 'Ion Mode',
      children: [
        {
          key: 'ionMode',
          style: { width: '100%', marginLeft: 0 },
          label: (
            <Form.Item<SearchFields>
              name={['propertyFilterOptions', 'ion_mode']}
              rules={[{ required: false }]}
              style={{ width: '100%', marginBottom: 0 }}
            >
              <FilterTable
                filterOptions={propertyFilterOptions?.ion_mode ?? []}
                filterName="propertyFilterOptions"
                label="ion_mode"
                showCounts={showCounts}
              />
            </Form.Item>
          ),
        },
      ],
    },
  ];
}

export default PropertyFilterOptionsMenuItems;
