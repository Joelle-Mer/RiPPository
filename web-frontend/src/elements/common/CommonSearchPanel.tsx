import './CommonSearchPanel.scss';

import { CSSProperties, ReactNode, useCallback, useEffect, useMemo } from 'react';

import type { FormProps } from 'antd';
import { Button } from 'antd';
import SearchFields from '../../types/filterOptions/SearchFields';
import ContentFilterOptions from '../../types/filterOptions/ContentFilterOtions';
import { useForm } from 'antd/es/form/Form';
import { Content } from 'antd/es/layout/layout';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import ValueCount from '../../types/ValueCount';
import { ItemType, MenuItemType } from 'antd/es/menu/interface';
import getActiveKeysFromFormData from '../../utils/getActiveKeysFromFormData';
import defaultSearchFieldValues from '../../constants/defaultSearchFieldValues';
import collapseButtonWidth from '../../constants/collapseButtonWidth';
import SearchPanelForm from './SearchPanelForm';

type InputProps = {
  items: ItemType<MenuItemType>[];
  initialValues: SearchFields;
  width: CSSProperties['width'];
  height: CSSProperties['height'];
  collapsed: boolean;
  propertyFilterOptions: ContentFilterOptions | null;
  onCollapse: (collapsed: boolean) => void;
  onSubmit: (data: SearchFields) => void;
  onValuesChange?: (allValues: SearchFields) => void;
  disableActiveKeys?: boolean;
  hideSearchButton?: boolean;
  footer?: ReactNode;
};

function CommonSearchPanel({
  items,
  initialValues,
  width,
  height,
  collapsed,
  propertyFilterOptions,
  onCollapse,
  onSubmit,
  onValuesChange,
  disableActiveKeys = false,
  hideSearchButton = false,
  footer,
}: InputProps) {
  const [form] = useForm<SearchFields>();
  const { setFieldValue, setFieldsValue } = form;

  useEffect(() => {
    if (initialValues) {
      setFieldsValue(initialValues);
    }
    const mapper = (vcs: ValueCount[]) => {
      return vcs.filter((vc) => vc.flag === true).map((vc) => vc.value);
    };
    setFieldValue('propertyFilterOptions', {
      contributor: mapper(propertyFilterOptions?.contributor ?? []),
      instrument_type: mapper(propertyFilterOptions?.instrument_type ?? []),
      ms_type: mapper(propertyFilterOptions?.ms_type ?? []),
      ion_mode: mapper(propertyFilterOptions?.ion_mode ?? []),
    } as SearchFields['propertyFilterOptions']);

    return () => {
      form.setFieldsValue(
        JSON.parse(JSON.stringify(defaultSearchFieldValues)) as SearchFields,
      );
    };
  }, [
    form,
    initialValues,
    propertyFilterOptions,
    setFieldValue,
    setFieldsValue,
  ]);

  const activeKeys = useMemo(
    () => (disableActiveKeys ? [] : getActiveKeysFromFormData(initialValues)),
    [disableActiveKeys, initialValues],
  );

  const handleOnSubmit: FormProps<SearchFields>['onFinish'] = useCallback(
    (values: SearchFields) => {
      onSubmit(values);
    },
    [onSubmit],
  );

  const handleOnCollapse = useCallback(() => {
    onCollapse(!collapsed);
  }, [collapsed, onCollapse]);

  return useMemo(
    () => (
      <Content
        style={{
          width,
          height,
          backgroundColor: 'white',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          userSelect: 'none',
        }}
      >
        <Content
          style={{
            minWidth: collapseButtonWidth,
            maxWidth: collapseButtonWidth,
            height: '100%',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <Button
            onClick={handleOnCollapse}
            size="large"
            style={{
              minWidth: collapseButtonWidth,
              maxWidth: collapseButtonWidth,
              height: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              border: 'none',
              color: 'blue',
              boxShadow: 'none',
            }}
          >
            {collapsed ? <RightOutlined /> : <LeftOutlined />}
          </Button>
        </Content>
        <div
          style={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <SearchPanelForm
            form={form}
            items={items}
            initialValues={initialValues}
            onSubmit={handleOnSubmit}
            onValuesChange={onValuesChange}
            collapsed={collapsed}
            width={width}
            height={height}
            collapseButtonWidth={collapseButtonWidth}
            defaultOpenKeys={activeKeys}
            defaultSelectedKeys={activeKeys}
            hideSearchButton={hideSearchButton}
          />
          {footer && !collapsed && (
            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                backgroundColor: '#fafafa',
                padding: '10px 12px',
                flexShrink: 0,
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </Content>
    ),
    [
      width,
      height,
      form,
      collapsed,
      initialValues,
      handleOnSubmit,
      onValuesChange,
      items,
      activeKeys,
      handleOnCollapse,
      hideSearchButton,
      footer,
    ],
  );
}

export default CommonSearchPanel;
