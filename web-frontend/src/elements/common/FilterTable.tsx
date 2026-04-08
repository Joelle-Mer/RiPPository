import { useCallback, useMemo } from 'react';
import { Checkbox, Form } from 'antd';
import { Content } from 'antd/es/layout/layout';
import ValueCount from '../../types/ValueCount';

type InputProps = {
  filterOptions: ValueCount[];
  filterName: string;
  label: string;
  showCounts?: boolean;
};

function FilterTable({
  filterOptions,
  filterName,
  label,
  showCounts = false,
}: InputProps) {
  const createOptions = useCallback(
    (_filterOptions: ValueCount[]) => {
      return _filterOptions.map((vc) => {
        return {
          label: showCounts ? (
            <Content>
              <label>{vc.value}</label>
              <label style={{ color: 'grey' }}>{' (' + vc.count + ')'}</label>
            </Content>
          ) : (
            vc.value
          ),
          value: vc.value,
          checked: vc.flag ?? false,
        };
      });
    },
    [showCounts],
  );

  const options = useMemo(
    () => createOptions(filterOptions),
    [createOptions, filterOptions],
  );

  return useMemo(
    () => (
      <Form.Item
        name={[filterName, label]}
        rules={[{ required: false }]}
        style={{ width: '100%', marginBottom: 0 }}
        initialValue={options.filter((vc) => vc.checked).map((vc) => vc.value)}
      >
        <Checkbox.Group
          options={options}
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '4px 0',
          }}
        />
      </Form.Item>
    ),
    [filterName, label, options],
  );
}

export default FilterTable;
