import { useCallback, useMemo, useState } from 'react';
import { Button, Form, Input, Upload, UploadProps, message } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import { Content } from 'antd/es/layout/layout';
import { RcFile } from 'antd/es/upload';

const { Dragger } = Upload;

type Submission = {
  jobId: string;
  compoundName: string;
  submitterName: string;
  submitterEmail: string;
  recordText: string;
  submittedAt: string;
  status: 'Pending';
};

const STORAGE_KEY = 'rippository_submissions';

function generateJobId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `RIP-${datePart}-${rand}`;
}

function SubmissionForm() {
  const [form] = Form.useForm();
  const [recordText, setRecordText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  const handleFileRead = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = new TextDecoder().decode(reader.result as ArrayBuffer);
      setRecordText(text);
    };
    reader.readAsArrayBuffer(file);
    return false;
  }, []);

  const uploadProps: UploadProps = useMemo(() => ({
    name: 'file',
    multiple: false,
    showUploadList: false,
    accept: '.txt',
    beforeUpload: (file: RcFile) => {
      handleFileRead(file);
      return false;
    },
    onDrop: (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      if (files[0]) handleFileRead(files[0]);
    },
  }), [handleFileRead]);

  const handleSubmit = useCallback(async () => {
    try {
      const values = await form.validateFields();

      if (recordText.trim().length === 0) {
        messageApi.error('Please paste or upload your record text.');
        return;
      }

      setSubmitting(true);

      const submission: Submission = {
        jobId: generateJobId(),
        compoundName: values.compoundName.trim(),
        submitterName: values.submitterName.trim(),
        submitterEmail: values.submitterEmail.trim(),
        recordText: recordText.trim(),
        submittedAt: new Date().toISOString(),
        status: 'Pending',
      };

      const existing: Submission[] = JSON.parse(
        localStorage.getItem(STORAGE_KEY) ?? '[]',
      );
      existing.unshift(submission);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));

      messageApi.success(
        `Submission received! Your job ID is ${submission.jobId}. You can track its status in the "My Submissions" tab.`,
        6,
      );

      form.resetFields();
      setRecordText('');
    } catch {
      // validation failed — Ant Design shows field errors automatically
    } finally {
      setSubmitting(false);
    }
  }, [form, recordText, messageApi]);

  return (
    <Content style={{ padding: '32px 48px', maxWidth: 780, margin: '0 auto', width: '100%' }}>
      {contextHolder}
      <p style={{ color: '#6b7280', marginBottom: 24, lineHeight: 1.7 }}>
        Submit your RiPP spectral record for inclusion in RiPPository. Records
        should follow the RiPPository record format. All submissions are manually
        reviewed before being added to the database.
      </p>

      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item
          label="Compound Name"
          name="compoundName"
          rules={[{ required: true, message: 'Please enter the compound name.' }]}
        >
          <Input placeholder="e.g. Nisin A" />
        </Form.Item>

        <Form.Item
          label="Your Name"
          name="submitterName"
          rules={[{ required: true, message: 'Please enter your name.' }]}
        >
          <Input placeholder="Full name" />
        </Form.Item>

        <Form.Item
          label="Your Email"
          name="submitterEmail"
          rules={[
            { required: true, message: 'Please enter your email.' },
            { type: 'email', message: 'Please enter a valid email.' },
          ]}
        >
          <Input placeholder="you@example.com" />
        </Form.Item>

        <Form.Item label="Record File (.txt)">
          <Dragger {...uploadProps} style={{ marginBottom: 8 }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag a .txt record file here</p>
            <p className="ant-upload-hint">RiPPository record format</p>
          </Dragger>
        </Form.Item>

        <Form.Item label="Or paste record text directly">
          <Input.TextArea
            rows={10}
            placeholder={'ACCESSION: RIPPOS-...\nRECORD_TITLE: ...\n...'}
            value={recordText}
            onChange={(e) => setRecordText(e.target.value)}
            allowClear
            style={{ fontFamily: 'monospace', fontSize: 12 }}
          />
        </Form.Item>

        <Button
          type="primary"
          onClick={handleSubmit}
          loading={submitting}
          style={{ width: '100%' }}
        >
          Submit Record
        </Button>
      </Form>
    </Content>
  );
}

export default SubmissionForm;
export { STORAGE_KEY };
export type { Submission };
