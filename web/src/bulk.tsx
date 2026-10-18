import { useState } from 'react';
import { api, useForm, type Section } from './api';
import { Field, FormError, Modal, SubsectionOptions, useToast } from './ui';

export type BulkAction = 'subsection' | 'addTag' | 'removeTag' | 'delete';
const TITLE: Record<BulkAction, string> = { subsection: 'Change subsection', addTag: 'Add tag', removeTag: 'Remove tag', delete: '' };

/** One small dialog for the four things that can be done to many transactions at once. */
export function BulkDialog({ action, ids, sections, tags, onDone, onClose }: {
  action: BulkAction; ids: number[]; sections: Section[]; tags: string[]; onDone: () => void; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [subsectionId, setSubsectionId] = useState('');
  const [tag, setTag] = useState('');
  const save = f.on(async () => {
    const { count } = await api<{ count: number }>('POST', '/transactions/bulk', {
      ids, action,
      ...(action === 'subsection' ? { subsectionId: subsectionId ? Number(subsectionId) : null } : action === 'delete' ? {} : { tag }),
    });
    onDone();
    toast(action === 'delete' ? `${count} transactions deleted` : 'Saved');
  });
  return (
    <Modal title={action === 'delete' ? `Delete ${ids.length} transactions?` : TITLE[action]} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError || f.errors.ids || ''} />
        {action === 'subsection' && (
          <Field label="Subsection" error={f.errors.subsectionId}>
            {(p) => (
              <select {...p} value={subsectionId} onChange={(e) => setSubsectionId(e.target.value)}>
                <option value="" disabled>Choose a subsection</option>
                <SubsectionOptions sections={sections} />
              </select>
            )}
          </Field>
        )}
        {action === 'addTag' && (
          <Field label="Tag" error={f.errors.tags}>
            {(p) => (
              <>
                <input {...p} list="bulk-tags" value={tag} onChange={(e) => setTag(e.target.value)} />
                <datalist id="bulk-tags">{tags.map((x) => <option key={x} value={x} />)}</datalist>
              </>
            )}
          </Field>
        )}
        {action === 'removeTag' && (
          <Field label="Tag" error={f.errors.tags}>
            {(p) => (
              <select {...p} value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="" disabled>Choose a tag</option>
                {tags.map((x) => <option key={x}>{x}</option>)}
              </select>
            )}
          </Field>
        )}
        <div className="ty-dialog__foot">
          <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className={`ty-btn ty-btn--${action === 'delete' ? 'danger' : 'primary'}`} disabled={f.busy}>{action === 'delete' ? 'Delete' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}
