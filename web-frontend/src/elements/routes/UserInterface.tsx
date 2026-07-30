import './UserInterface.scss';

import { Content } from 'antd/es/layout/layout';
import Header from '../header/Header';
import Footer from '../footer/Footer';
import { Component, JSX, useCallback, useEffect, useMemo, useState } from 'react';
import { Layout } from 'antd';
import Modal from 'antd/es/modal/Modal';

class PageErrorBoundary extends Component<
  { children: JSX.Element },
  { error: string | null }
> {
  constructor(props: { children: JSX.Element }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: unknown) {
    const msg = err instanceof Error ? err.message + '\n' + err.stack : String(err);
    return { error: msg };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: 'red', whiteSpace: 'pre-wrap', fontSize: 13 }}>
          <strong>Page error (please report this):</strong>
          <br />
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

const headerHeight = 120;
const footerHeight = 50;

type InputProps = {
  body: JSX.Element;
};

function UserInterface({ body }: InputProps) {
  const [showDataPrivacyModal, setShowDataPrivacyModal] =
    useState<boolean>(false);
  const [dataPrivacyContainer, setDataPrivacyContainer] =
    useState<JSX.Element | null>(null);

  useEffect(() => {
    function fetchDataPrivacyInformation() {
      const container = document.getElementById('data-privacy-container');
      if (container) {
        setDataPrivacyContainer(
          container.innerHTML ? (
            <div dangerouslySetInnerHTML={{ __html: container.innerHTML }} />
          ) : null,
        );
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (window.showDataPrivacyModal === true) {
          setShowDataPrivacyModal(true);
        }
      }
    }

    fetchDataPrivacyInformation();
  }, []);

  const handleOnClickDataPrivacy = useCallback(() => {
    setShowDataPrivacyModal(true);
  }, []);

  return useMemo(
    () => (
      <Layout className="user-interface">
        <Header height={headerHeight} />
        <Content
          style={{
            width: '100%',
            height: `calc(100vh - ${headerHeight + footerHeight}px)`,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            overflow: 'hidden',
          }}
        >
          <PageErrorBoundary>{body}</PageErrorBoundary>
        </Content>
        <Footer
          height={footerHeight}
          enableDataPrivacyButton={dataPrivacyContainer !== null}
          onClickDataPrivacy={handleOnClickDataPrivacy}
        />
        <Modal
          open={showDataPrivacyModal}
          onCancel={() => setShowDataPrivacyModal(false)}
          width="100%"
          style={{ top: 20 }}
          title="Data Privacy Information"
          cancelButtonProps={{ style: { display: 'none' } }}
          onOk={() => setShowDataPrivacyModal(false)}
        >
          <Content
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {dataPrivacyContainer ? (
              dataPrivacyContainer
            ) : (
              <div style={{ textAlign: 'center' }}>
                No data privacy information available.
              </div>
            )}
          </Content>
        </Modal>
      </Layout>
    ),
    [
      body,
      dataPrivacyContainer,
      handleOnClickDataPrivacy,
      showDataPrivacyModal,
    ],
  );
}

export default UserInterface;
