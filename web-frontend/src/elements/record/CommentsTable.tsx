import { CSSProperties, JSX, useMemo } from 'react';
import SubTag from '../../types/record/SubTag';
import Table from '../basic/Table';
import { pdbIdsIn, pdbUrl } from '../routes/pages/submit/massbankRecord';

type InputProps = {
  comments: SubTag[] | undefined;
  width: CSSProperties['width'];
  height: CSSProperties['height'];
};

// a comment naming PDB structures, written by the Submit page ("PDB 7ZWJ") or typed in a note
// ("PDB ID: 7ZWJ"), shows each identifier as a link to its entry; `component` is the plain text the
// table's copy button takes
function PdbLinks({ ids }: { ids: string[]; component: string }) {
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && ', '}
          <a href={pdbUrl(id)} target="_blank" rel="noreferrer" title={`Open ${id} at the RCSB Protein Data Bank`}>
            {id}
          </a>
        </span>
      ))}
    </>
  );
}

const pdbIdsOf = (comment: SubTag) =>
  pdbIdsIn(comment.subtag ? `${comment.subtag} ${comment.value}` : comment.value);

function CommentsTable({ comments, width, height }: InputProps) {
  return useMemo(() => {
    if (!comments || comments.length === 0) {
      return null;
    }

    const columns = [
      {
        title: 'Comment',
        dataIndex: 'Comment',
        key: 'comment',
        align: 'center' as const,
      },
      {
        title: 'Text',
        dataIndex: 'Text',
        key: 'text',
        align: 'center' as const,
      },
    ];

    const dataSource: { key: string; Comment: string; Text: string | JSX.Element }[] = [];
    comments.forEach((comment, i) =>
      dataSource.push({
        key: `comments-key-${i}`,
        Comment: pdbIdsOf(comment).length ? 'PDB' : comment.subtag,
        Text: pdbIdsOf(comment).length ? (
          <PdbLinks ids={pdbIdsOf(comment)} component={pdbIdsOf(comment).join(', ')} />
        ) : (
          comment.value
        ),
      }),
    );

    return (
      <Table
        tableName="Comments Table"
        columns={columns}
        dataSource={dataSource}
        style={{ width, height }}
        enableExport
      />
    );
  }, [comments, height, width]);
}

export default CommentsTable;
