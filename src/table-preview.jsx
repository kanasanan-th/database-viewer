import React, { useEffect, useId, useRef, useState } from 'react';
import { Pencil, Plus, Trash2, Wand2, X } from 'lucide-react';
import { CodeInput } from './code-block.jsx';
import { fieldKind, fromInputValue, generateValue, toInputValue } from './field-kinds.mjs';
import { validatePreviewValue } from './preview-values.mjs';
import { referenceValues } from './seed.mjs';

const truthy = value => /^(true|1)$/i.test(value);

function FieldInput({ id, field, config, options, value, onChange, invalid, describedBy, required }) {
  const aria = {
    id,
    'aria-invalid': invalid || undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
  };
  if (options) {
    return (
      <select className="themed-select" {...aria} value={value} onChange={event => onChange(event.target.value)}>
        <option value="">{options.length ? 'Select a reference' : 'No target rows'}</option>
        {value !== '' && !options.includes(value) && (
          <option value={value} disabled>
            {value} (missing)
          </option>
        )}
        {options.map(option => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  switch (config.kind) {
    case 'boolean': {
      const [yes, no] = config.native;
      return (
        <select className="themed-select" {...aria} value={value} onChange={event => onChange(event.target.value)}>
          <option value="">{required ? 'Select…' : 'Not set'}</option>
          {value !== '' && value !== yes && value !== no && <option value={value}>{value}</option>}
          <option value={yes}>True</option>
          <option value={no}>False</option>
        </select>
      );
    }
    case 'number':
      return (
        <input
          type="number"
          {...aria}
          step={config.step}
          inputMode={config.integer ? 'numeric' : 'decimal'}
          value={value}
          onKeyDown={
            config.integer
              ? event => {
                  if (['e', 'E', '.', ','].includes(event.key)) event.preventDefault();
                }
              : undefined
          }
          onChange={event => onChange(event.target.value)}
        />
      );
    case 'date':
      return <input type="date" {...aria} value={value} onChange={event => onChange(event.target.value)} />;
    case 'time':
      return (
        <input
          type="time"
          step="1"
          {...aria}
          value={toInputValue(config, value)}
          onChange={event => onChange(fromInputValue(config, event.target.value))}
        />
      );
    case 'datetime':
      return (
        <div className="input-with-suffix">
          <input
            type="datetime-local"
            step="1"
            {...aria}
            value={toInputValue(config, value)}
            onChange={event => onChange(fromInputValue(config, event.target.value))}
          />
          {config.zone && <span title="Stored as UTC">UTC</span>}
        </div>
      );
    case 'json':
      return (
        <CodeInput
          label={field.name}
          language="json"
          value={value}
          onChange={onChange}
          hint={config.hint}
          numbers={false}
          tip="Double quotes for keys and strings · Ctrl+Space inserts an object or array"
        />
      );
    case 'textarea':
      return (
        <textarea
          {...aria}
          rows={4}
          maxLength={config.maxLength}
          value={value}
          onChange={event => onChange(event.target.value)}
        />
      );
    default:
      return (
        <div className="input-with-suffix">
          <input
            type="text"
            {...aria}
            className={config.mono ? 'mono' : undefined}
            maxLength={config.maxLength}
            placeholder={config.hint}
            autoComplete="off"
            spellCheck="false"
            value={value}
            onChange={event => onChange(event.target.value)}
          />
          {config.generate && (
            <button
              type="button"
              className="icon-button"
              title="Generate a value"
              aria-label={'Generate ' + field.name}
              onClick={() => onChange(generateValue(config.generate))}
            >
              <Wand2 size={15} />
            </button>
          )}
        </div>
      );
  }
}

function CellValue({ config, value, missing }) {
  if (value === '') return <span className="cell-empty">—</span>;
  if (config.kind === 'boolean') {
    return (
      <span className={'bool-pill ' + (truthy(value) ? 'yes' : 'no')}>
        {truthy(value) ? 'True' : /^(false|0)$/i.test(value) ? 'False' : value}
      </span>
    );
  }
  return (
    <>
      <span className={'cell-text' + (config.kind === 'json' || config.mono ? ' mono' : '')} title={value}>
        {value}
      </span>
      {missing && <small className="preview-cell-error">Missing reference</small>}
    </>
  );
}

export function TablePreview({ entity, rows, dialect, preview, database, onChange, onClose }) {
  const dialog = useRef(null);
  const formRef = useRef(null);
  const idPrefix = useId();
  const [form, setForm] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const required = field => field.required || entity.primary.includes(field.name);
  const configs = new Map(entity.fields.map(field => [field.name, fieldKind(field.type, dialect)]));
  const choices = new Map(
    entity.fields.filter(field => field.ref).map(field => [field.name, referenceValues(preview, database, field.ref)])
  );

  useEffect(() => {
    dialog.current.showModal();
  }, []);
  useEffect(() => {
    if (!form) return;
    const target = form.focus
      ? formRef.current?.querySelector('[data-field="' + form.focus + '"]')
      : formRef.current?.querySelector('[data-field]');
    target?.querySelector('input, select, textarea, .cm-content')?.focus();
    // Focus once when the form opens, not on each keystroke.
  }, [form?.index, form?.focus]);

  function open(index, focus = null) {
    const row = rows[index];
    const values = Object.fromEntries(
      entity.fields.map(field => [
        field.name,
        row
          ? (row[field.name] ?? '')
          : field.default?.kind === 'literal' && field.default.value !== null
            ? String(field.default.value)
            : '',
      ])
    );
    setErrors({});
    setError('');
    setDeleting(null);
    setForm({ index, values, focus });
  }

  const close = () => {
    setForm(null);
    setErrors({});
  };
  const setValue = (name, value) => {
    setForm(previous => ({ ...previous, values: { ...previous.values, [name]: value } }));
    setErrors(previous => {
      if (!Object.hasOwn(previous, name)) return previous;
      const next = { ...previous };
      delete next[name];
      return next;
    });
  };

  function apply(next) {
    try {
      onChange(next);
      setError('');
      return true;
    } catch (failure) {
      setError(failure.message);
      return false;
    }
  }

  function save(event) {
    event.preventDefault();
    const found = Object.fromEntries(
      entity.fields.flatMap(field => {
        const value = form.values[field.name];
        const message =
          validatePreviewValue(field.type, value, dialect, required(field)) ||
          (value && field.ref && !choices.get(field.name).includes(value)
            ? 'Select a value from ' + field.ref.entity + '.' + field.ref.field + '.'
            : null);
        return message ? [[field.name, message]] : [];
      })
    );
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      formRef.current
        .querySelector('[data-field="' + first + '"]')
        ?.querySelector('input, select, textarea, .cm-content')
        ?.focus();
      return;
    }
    const next = [...rows];
    if (form.index === rows.length) next.push(form.values);
    else next[form.index] = { ...rows[form.index], ...form.values };
    if (apply(next)) close();
  }

  const busy = deleting !== null;
  return (
    <dialog
      className="help table-preview"
      ref={dialog}
      onClose={onClose}
      aria-labelledby="preview-title"
      onCancel={event => {
        if (form) {
          event.preventDefault();
          close();
        }
      }}
    >
      <header>
        <div>
          <h2 id="preview-title">{entity.name}</h2>
          <p>
            Draft data · {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </p>
        </div>
        <button aria-label="Close table preview" onClick={() => dialog.current.close()}>
          <X size={16} />
        </button>
      </header>
      {form ? (
        <form ref={formRef} className="row-form" onSubmit={save} noValidate>
          <h3>{form.index === rows.length ? 'New row' : 'Edit row ' + (form.index + 1)}</h3>
          <div className="row-fields">
            {entity.fields.map(field => {
              const name = field.name;
              const config = configs.get(name);
              const id = idPrefix + '-' + name;
              const errorId = id + '-error';
              const wide = config.kind === 'json' || config.kind === 'textarea';
              return (
                <div
                  className={'row-field' + (wide ? ' wide' : '') + (errors[name] ? ' invalid' : '')}
                  key={name}
                  data-field={name}
                >
                  <label htmlFor={id}>
                    <span className="field-name">
                      {name}
                      {required(field) && (
                        <b title="Required" aria-hidden="true">
                          {' '}
                          *
                        </b>
                      )}
                    </span>
                    <small>
                      {field.type}
                      {entity.primary.includes(name) ? ' · PK' : ''}
                      {field.ref ? ' → ' + field.ref.entity + '.' + field.ref.field : ''}
                    </small>
                  </label>
                  <FieldInput
                    id={id}
                    field={field}
                    config={config}
                    options={choices.get(name)}
                    value={form.values[name]}
                    onChange={value => setValue(name, value)}
                    invalid={Boolean(errors[name])}
                    required={required(field)}
                    describedBy={errors[name] ? errorId : undefined}
                  />
                  {errors[name] && (
                    <small className="preview-cell-error" id={errorId} role="alert">
                      {errors[name]}
                    </small>
                  )}
                </div>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="preview-error">
              {error}
            </p>
          )}
          <div className="row-form-actions">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="primary">
              {form.index === rows.length ? 'Add row' : 'Save row'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="preview-toolbar">
            <p className="preview-hint">Double-click a cell, or press Enter on it, to edit that row.</p>
            <button className="primary" disabled={busy} onClick={() => open(rows.length)}>
              <Plus size={15} />
              Add row
            </button>
          </div>
          <div className="preview-scroll">
            {rows.length ? (
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="col-index">
                      #
                    </th>
                    {entity.fields.map(field => (
                      <th scope="col" key={field.name}>
                        <span>{field.name}</span>
                        <small>
                          {field.type}
                          {entity.primary.includes(field.name) ? ' · PK' : required(field) ? ' · Required' : ''}
                        </small>
                      </th>
                    ))}
                    <th scope="col" className="col-actions">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className={deleting === index ? 'preview-deleting' : undefined}>
                      <th scope="row" className="col-index">
                        {index + 1}
                      </th>
                      {entity.fields.map(field => {
                        const value = row[field.name] ?? '';
                        const options = choices.get(field.name);
                        return (
                          <td
                            key={field.name}
                            className="preview-cell-editable"
                            tabIndex={busy ? undefined : 0}
                            onDoubleClick={busy ? undefined : () => open(index, field.name)}
                            onKeyDown={
                              busy
                                ? undefined
                                : event => {
                                    if (event.key === 'Enter' || event.key === 'F2') {
                                      event.preventDefault();
                                      open(index, field.name);
                                    }
                                  }
                            }
                          >
                            <CellValue
                              config={configs.get(field.name)}
                              value={value}
                              missing={value !== '' && options && !options.includes(value)}
                            />
                          </td>
                        );
                      })}
                      <td className="col-actions">
                        <div className="row-actions">
                          <button
                            type="button"
                            className="icon-button"
                            title="Edit row"
                            aria-label={'Edit row ' + (index + 1)}
                            disabled={busy}
                            onClick={() => open(index)}
                          >
                            <Pencil size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-button danger"
                            title="Delete row"
                            aria-label={'Delete row ' + (index + 1)}
                            disabled={busy}
                            onClick={() => {
                              setError('');
                              setDeleting(index);
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="preview-empty">
                <p>No rows yet.</p>
                <p>Add a row to preview data for this schema.</p>
              </div>
            )}
          </div>
          {deleting !== null && (
            <div className="preview-confirm" role="alertdialog" aria-label="Confirm delete">
              <span>Delete row {deleting + 1}?</span>
              <button
                onClick={() => {
                  setError('');
                  setDeleting(null);
                }}
              >
                Cancel
              </button>
              <button
                className="danger-solid"
                onClick={() => {
                  if (apply(rows.filter((_, index) => index !== deleting))) setDeleting(null);
                }}
              >
                Confirm delete
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="preview-error">
              {error}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
