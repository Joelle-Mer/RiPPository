import { Button, Form, FormInstance, Menu } from 'antd';
import { Content } from 'antd/es/layout/layout';
import { CSSProperties, useMemo } from 'react';
import SearchFields from '../../types/filterOptions/SearchFields';
import { ItemType, MenuItemType } from 'antd/es/menu/interface';

const submitButtonHeight = 40;

type InputProps = {
  form: FormInstance<SearchFields>;
  items: ItemType<MenuItemType>[];
  initialValues: SearchFields;
  onSubmit: (data: SearchFields) => void;
  onValuesChange?: (allValues: SearchFields) => void;
  collapsed: boolean;
  collapseButtonWidth: number;
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  defaultOpenKeys?: string[];
  defaultSelectedKeys?: string[];
  style?: CSSProperties;
  hideSearchButton?: boolean;
};

function SearchPanelForm({
  form,
  items,
  initialValues,
  onSubmit,
  onValuesChange,
  collapsed,
  collapseButtonWidth,
  width = '100%',
  height = '100%',
  defaultOpenKeys = [],
  defaultSelectedKeys = [],
  style = {},
  hideSearchButton = false,
}: InputProps) {
  return useMemo(
    () => (
      <Form.Provider>
        <Form
          form={form}
          autoComplete="off"
          layout="inline"
          style={{
            width:
              typeof width === 'number'
                ? width - collapseButtonWidth
                : `calc(${width} - ${collapseButtonWidth}px)`,
            height,
            display: collapsed ? 'none' : 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            userSelect: 'none',
            backgroundColor: 'transparent',
            ...style,
          }}
          initialValues={initialValues}
          onFinish={onSubmit}
          onValuesChange={onValuesChange ? (_, all) => onValuesChange(all as SearchFields) : undefined}
        >
          <Content
            style={{
              width: '100%',
              flex: 1,
              overflowY: 'auto',
            }}
          >
            <Menu
              style={{
                width: '100%',
                border: 'none',
                backgroundColor: 'transparent',
              }}
              mode="inline"
              items={items}
              inlineIndent={10}
              defaultOpenKeys={defaultOpenKeys}
              defaultSelectedKeys={defaultSelectedKeys}
            />
          </Content>
          {!hideSearchButton && (
            <Button
              htmlType="submit"
              style={{
                width: 150,
                height: submitButtonHeight - 10,
                marginTop: 5,
                marginBottom: 5,
                flexShrink: 0,
                backgroundColor: 'rgb(167, 199, 254)',
              }}
            >
              Search
            </Button>
          )}
        </Form>
      </Form.Provider>
    ),
    [
      collapseButtonWidth,
      collapsed,
      defaultOpenKeys,
      defaultSelectedKeys,
      form,
      height,
      initialValues,
      items,
      onSubmit,
      onValuesChange,
      style,
      width,
      hideSearchButton,
    ],
  );
}

export default SearchPanelForm;
