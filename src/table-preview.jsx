import React, { useEffect, useId, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { validatePreviewValue } from './preview-values.mjs';
import { referenceValues } from './seed.mjs';

export function TablePreview({ entity, rows, dialect, preview, database, onChange, onClose }) {
  const dialog = useRef(null);
  const errorPrefix = useId();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [cellErrors, setCellErrors] = useState({});
  const [error, setError] = useState('');
  const required = field => field.required || entity.primary.includes(field.name);
  const gridRows = editing?.index === rows.length ? [...rows, {}] : rows;
  const choices = new Map(entity.fields.filter(field => field.ref).map(field =>
    [field.name, referenceValues(preview, database, field.ref)]));

  useEffect(() => { dialog.current.showModal(); }, []);
  useEffect(() => {
    if (!editing) return;
    const cell = dialog.current.querySelector('[data-edit-field]');
    if (!cell) return;
    cell.focus();
    if (cell.tagName === 'SELECT') return;
    const selection = cell.ownerDocument.getSelection();
    selection.selectAllChildren(cell);
    selection.collapseToEnd();
  }, [editing]);

  function edit(index, field = null) {
    setCellErrors({});
    setError('');
    setEditing(index === null ? null : { index, field });
  }

  function saveRow(event) {
    event.preventDefault();
    if (editing === null) return;
    const editors = [...dialog.current.querySelectorAll('[data-edit-field]')];
    const values = Object.fromEntries(editors.map(cell => [
      cell.dataset.editField,
      cell.tagName === 'SELECT' ? cell.value :
        cell.childNodes.length === 1 && cell.firstChild.nodeName === 'BR' ? '' : cell.innerText,
    ]));
    const errors = Object.fromEntries(entity.fields.flatMap(field => {
      if (!Object.hasOwn(values, field.name)) return [];
      const value = values[field.name];
      const message = validatePreviewValue(field.type, value, dialect, required(field)) ||
        (value && field.ref && !choices.get(field.name).includes(value) ?
          'Select a value from ' + field.ref.entity + '.' + field.ref.field + '.' : null);
      return message ? [[field.name, message]] : [];
    }));
    setCellErrors(errors);
    const firstInvalid = Object.keys(errors)[0];
    if (firstInvalid) {
      editors.find(cell => cell.dataset.editField === firstInvalid)?.focus();
      return;
    }
    const next = [...rows];
    if (editing.index === rows.length) next.push(values);
    else next[editing.index] = { ...rows[editing.index], ...values };
    if (apply(next)) edit(null);
  }

  function apply(next) {
    try {
      onChange(next);
      setError('');
      return true;
    } catch (error) {
      setError(error.message);
      return false;
    }
  }

  return <dialog className="help table-preview" ref={dialog} onClose={onClose} aria-labelledby="preview-title">
    <header>
      <div><h2 id="preview-title">{entity.name}</h2><p>Draft data · {rows.length} {rows.length === 1 ? 'row' : 'rows'}</p></div>
      <button aria-label="Close table preview" onClick={() => dialog.current.close()}><X size={16} /></button>
    </header>
    <p className="preview-hint">Double-click a cell to edit. Enter saves and Esc cancels.</p>
    <form onSubmit={saveRow} onKeyDown={event => {
      if (event.key === 'Escape' && editing !== null) {
        event.preventDefault();
        edit(null);
      }
    }}>
      <div className="preview-scroll">
        <table>
          <thead><tr><th scope="col">#</th>{entity.fields.map(field => <th scope="col" key={field.name}>
            {field.name}<small>{field.type}{entity.primary.includes(field.name) ? ' · PK' : field.required ? ' · Required' : ''}</small>
          </th>)}<th scope="col">Actions</th></tr></thead>
          <tbody>{gridRows.map((row, index) => {
            const isEditing = editing?.index === index;
            return <tr key={index} className={isEditing ? 'preview-editing' : undefined}>
              <th scope="row">{index + 1}</th>
              {entity.fields.map(field => {
                const name = field.name;
                const isCellEditing = isEditing && (editing.field === null || editing.field === name);
                const canEdit = editing === null && deleting === null;
                const initial = Object.hasOwn(row, name) ? row[name] :
                  index === rows.length && field.default?.kind === 'literal' && field.default.value !== null ? String(field.default.value) : '';
                const message = isCellEditing && Object.hasOwn(cellErrors, name) ? cellErrors[name] : null;
                const errorId = errorPrefix + '-' + name;
                const options = choices.get(name);
                const missingReference = initial !== '' && options && !options.includes(initial);
                return <td key={name} className={isCellEditing ? 'preview-cell-active' : canEdit ? 'preview-cell-editable' : undefined}
                  tabIndex={canEdit ? 0 : undefined}
                  onDoubleClick={canEdit ? () => edit(index, name) : undefined}
                  onKeyDown={canEdit ? event => {
                    if (event.key === 'Enter' || event.key === 'F2') {
                      event.preventDefault();
                      edit(index, name);
                    }
                  } : undefined}>
                  {isCellEditing ? <>
                    {options ? <select className="themed-select" data-edit-field={name} aria-label={name} defaultValue={initial}
                      aria-invalid={message ? true : undefined} aria-describedby={message ? errorId : undefined}>
                      <option value="">{options.length ? 'Select a reference' : 'No target rows'}</option>
                      {missingReference && <option value={initial} disabled>{initial} (missing)</option>}
                      {options.map(value => <option key={value} value={value}>{value}</option>)}
                    </select> : <div contentEditable="plaintext-only" suppressContentEditableWarning data-edit-field={name}
                      role="textbox" aria-label={name} aria-required={required(field) || undefined}
                      aria-invalid={message ? true : undefined} aria-describedby={message ? errorId : undefined}
                      onKeyDown={event => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) saveRow(event);
                      }}
                      onInput={() => {
                        if (!message) return;
                        setCellErrors(previous => {
                          const next = { ...previous };
                          delete next[name];
                          return next;
                        });
                      }}>{initial}</div>}
                    {message && <small className="preview-cell-error" id={errorId} role="alert">{message}</small>}
                  </> : <>{initial || '—'}{missingReference && <small className="preview-cell-error">Missing reference</small>}</>}
                </td>;
              })}
              <td><div className="preview-actions">
                {isEditing ? <>
                  <button key="save" className="primary" type="submit">{editing.field === null ? 'Save row' : 'Save cell'}</button>
                  <button type="button" onClick={() => edit(null)}>Cancel</button>
                </> : <>
                  <button key="edit" type="button" aria-label={'Edit row ' + (index + 1)} disabled={editing !== null || deleting !== null}
                    onClick={() => edit(index)}>Edit</button>
                  <button type="button" aria-label={'Delete row ' + (index + 1)} disabled={editing !== null || deleting !== null}
                    onClick={() => { setError(''); setDeleting(index); }}>Delete</button>
                </>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
        {!gridRows.length && <p className="preview-empty">No rows yet. Add a row to preview data for this schema.</p>}
      </div>
    </form>
    {deleting !== null ? <div className="preview-confirm">
      <span>Delete row {deleting + 1}?</span>
      <button onClick={() => { setError(''); setDeleting(null); }}>Cancel</button>
      <button onClick={() => {
        if (apply(rows.filter((_, index) => index !== deleting))) setDeleting(null);
      }}>Confirm delete</button>
    </div> : editing === null && <button className="primary" onClick={() => edit(rows.length)}><Plus size={15} />Add row</button>}
    {error && <p role="alert" className="preview-error">{error}</p>}
  </dialog>;
}
