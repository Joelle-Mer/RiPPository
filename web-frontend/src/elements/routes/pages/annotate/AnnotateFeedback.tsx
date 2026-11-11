import { useState } from 'react';
import { Button, Input, Radio } from 'antd';
import { FeedbackKind, feedbackKinds, feedbackLinks } from './annotateFormat';

// Neither way sends anything from this page: email opens the visitor's own mail
// program and GitHub opens its own form, both filled in, and the visitor sends it.
const issueRepository = 'https://github.com/Joelle-Mer/RiPPository';
// set at build time (VITE_FEEDBACK_EMAIL in compose/.env); empty hides the email button
const feedbackEmail =
  (import.meta.env.VITE_FEEDBACK_EMAIL as string | undefined)?.trim() ?? '';
const maxLength = 2000;

type InputProps = {
  example: string | null;
};

function AnnotateFeedback({ example }: InputProps) {
  const [kind, setKind] = useState<FeedbackKind>('problem');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const links = feedbackLinks(
    kind,
    title,
    text,
    example,
    feedbackEmail,
    issueRepository,
  );
  const empty = text.trim().length === 0;

  return (
    <section className="annotate-card annotate-feedback" id="annotate-feedback">
      <h3>Feedback and feature requests</h3>
      <p className="annotate-hint">
        Something wrong, or a feature you would like added? Write it here.
        {links.mail
          ? ' Send by email needs no account: your own mail program opens with the message filled in.'
          : ''}{' '}
        Nothing is sent until you press Send
        {links.mail ? ' in your mail or Submit on GitHub' : ' on GitHub'}. Your
        spectrum is never included; if one of our examples is loaded, its record
        number is.
      </p>
      <Radio.Group
        aria-label="Kind of feedback"
        value={kind}
        onChange={(event) => setKind(event.target.value as FeedbackKind)}
        options={(Object.keys(feedbackKinds) as FeedbackKind[]).map((k) => ({
          value: k,
          label: feedbackKinds[k],
        }))}
      />
      <Input
        aria-label="Feedback title"
        placeholder="Short title (optional)"
        maxLength={120}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <Input.TextArea
        aria-label="Feedback"
        placeholder={
          kind === 'feature'
            ? 'What you would like the page to do, and what you would use it for'
            : 'What happened, and what you expected'
        }
        rows={4}
        maxLength={maxLength}
        showCount
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="annotate-paste-row">
        {links.mail && (
          <Button
            type="primary"
            disabled={empty}
            href={empty ? undefined : links.mail}
          >
            Send by email
          </Button>
        )}
        <Button
          type={links.mail ? 'default' : 'primary'}
          disabled={empty}
          href={empty ? undefined : links.issue}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open as a GitHub issue
        </Button>
      </div>
      <p className="annotate-hint">
        A GitHub issue needs a free GitHub account, and everyone can read it.
      </p>
    </section>
  );
}

export default AnnotateFeedback;
