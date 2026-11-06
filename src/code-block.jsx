import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, Lightbulb } from 'lucide-react';
import { acceptCompletion, autocompletion, closeBrackets, startCompletion } from '@codemirror/autocomplete';
import { completionSource, codeTips } from './code-hints.mjs';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';

const native = window.studio;
const external = Annotation.define();

const words = list => new RegExp('^(?:' + list.join('|') + ')$', 'i');
const sqlWords = words([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'null',
  'insert',
  'into',
  'values',
  'update',
  'set',
  'delete',
  'create',
  'table',
  'alter',
  'add',
  'drop',
  'column',
  'constraint',
  'primary',
  'key',
  'foreign',
  'references',
  'unique',
  'index',
  'default',
  'on',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'group',
  'by',
  'order',
  'limit',
  'offset',
  'as',
  'in',
  'is',
  'like',
  'between',
  'case',
  'when',
  'then',
  'else',
  'end',
  'having',
  'distinct',
  'union',
  'all',
  'if',
  'exists',
  'cascade',
  'restrict',
  'check',
  'begin',
  'commit',
  'database',
  'use',
  'engine',
  'charset',
  'collate',
  'with',
  'asc',
  'desc',
]);
const dbmlWords = words([
  'table',
  'ref',
  'enum',
  'project',
  'indexes',
  'note',
  'pk',
  'primary',
  'key',
  'unique',
  'not',
  'null',
  'default',
  'increment',
  'tablegroup',
  'as',
]);
const prismaWords = words(['model', 'enum', 'datasource', 'generator', 'type', 'view']);
const jsWords = words(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'new', 'db', 'use']);
const atomWords = /^(?:true|false|null)$/i;

// Small stream tokenizers keep the bundle free of per-language packages; they only need to colour tokens.
function tokenizer({ line, block, keywords, quotes = '\'"`', numbers = true }) {
  return StreamLanguage.define({
    startState: () => ({ inBlock: false }),
    token(stream, state) {
      if (state.inBlock) {
        if (stream.skipTo('*/')) {
          stream.match('*/');
          state.inBlock = false;
        } else stream.skipToEnd();
        return 'comment';
      }
      if (stream.eatSpace()) return null;
      if (block && stream.match('/*')) {
        state.inBlock = true;
        if (stream.skipTo('*/')) {
          stream.match('*/');
          state.inBlock = false;
        } else stream.skipToEnd();
        return 'comment';
      }
      for (const marker of line)
        if (stream.match(marker)) {
          stream.skipToEnd();
          return 'comment';
        }
      const quote = stream.peek();
      if (quote && quotes.includes(quote)) {
        stream.next();
        let escaped = false;
        for (let char = stream.next(); char; char = stream.next()) {
          if (char === quote && !escaped) break;
          escaped = !escaped && char === '\\';
        }
        return quote === '"' && keywords === sqlWords ? 'variableName' : 'string';
      }
      if (numbers && stream.match(/^-?\d+(?:\.\d+)?/)) return 'number';
      if (stream.match(/^[A-Za-z_][\w$]*/)) {
        const word = stream.current();
        if (atomWords.test(word) && keywords !== sqlWords) return 'atom';
        return keywords?.test(word) ? 'keyword' : null;
      }
      stream.next();
      return null;
    },
  });
}

const json = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return stream.match(/^\s*(?=:)/, false) ? 'propertyName' : 'string';
    if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return 'number';
    if (stream.match(/^(?:true|false|null)\b/)) return 'atom';
    stream.next();
    return null;
  },
});

const toml = StreamLanguage.define({
  token(stream) {
    if (stream.sol() && stream.match(/^\s*\[[^\]]*\]/)) return 'keyword';
    if (stream.eatSpace()) return null;
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return 'string';
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/^(?:true|false)\b/)) return 'atom';
    if (stream.match(/^[A-Za-z_][\w-]*(?=\s*=)/)) return 'propertyName';
    stream.next();
    return null;
  },
});

const shell = StreamLanguage.define({
  startState: () => ({ command: true }),
  token(stream, state) {
    if (stream.sol()) state.command = true;
    if (stream.eatSpace()) return null;
    if (stream.match('#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"(?:\\.|[^"\\])*"?/) || stream.match(/^'[^']*'?/)) {
      state.command = false;
      return 'string';
    }
    if (stream.match(/^--?[A-Za-z][\w-]*/)) {
      state.command = false;
      return 'propertyName';
    }
    if (stream.match(/^\S+/)) {
      const wasCommand = state.command;
      state.command = false;
      return wasCommand ? 'keyword' : /^https?:\/\//.test(stream.current()) ? 'atom' : null;
    }
    stream.next();
    return null;
  },
});

const schema = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(?:#|\/\/)/)) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return 'string';
    if (stream.match(/^[a-z_]\w*/i)) {
      return /^(database|table|collection|index|primary|charset|collate|pk|required|unique|ref|default|ondelete)$/.test(
        stream.current()
      )
        ? 'keyword'
        : null;
    }
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
    stream.next();
    return null;
  },
});

export const codeLanguages = {
  plain: [],
  json,
  toml,
  shell,
  schema,
  sql: tokenizer({ line: ['--', '#'], block: true, keywords: sqlWords }),
  dbml: tokenizer({ line: ['//'], block: true, keywords: dbmlWords }),
  prisma: tokenizer({ line: ['//'], keywords: prismaWords }),
  js: tokenizer({ line: ['//'], block: true, keywords: jsWords }),
};

export const languageNames = {
  plain: 'Text',
  json: 'JSON',
  toml: 'TOML',
  shell: 'Shell',
  schema: 'Schema',
  sql: 'SQL',
  dbml: 'DBML',
  prisma: 'Prisma',
  js: 'mongosh',
};

export const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#132bcc', fontWeight: '600' },
  { tag: tags.propertyName, color: '#2a3a8c' },
  { tag: tags.string, color: '#bb6359' },
  { tag: tags.variableName, color: '#0f766e' },
  { tag: tags.number, color: '#9a5b00' },
  { tag: tags.atom, color: '#7a3ea1' },
  { tag: tags.comment, color: '#8a93a1', fontStyle: 'italic' },
]);

const codeTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: '#0d0d0e' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: "'Cascadia Code', Consolas, monospace", fontSize: '12.5px', lineHeight: '1.7' },
  '.cm-content': { padding: '10px 0', caretColor: '#132bcc' },
  '.cm-line': { padding: '0 14px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: '#aab2c0', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 4px 0 12px', minWidth: '30px' },
  '.cm-placeholder': { color: '#98a2b0' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#c9d3f6' },
});

function CodeSurface({ value, onChange, readOnly, language, label, hint, numbers, maxLength, complete, viewRef }) {
  const host = useRef(null);
  const view = useRef(null);
  const change = useRef(onChange);
  useLayoutEffect(() => {
    change.current = onChange;
  }, [onChange]);
  useLayoutEffect(() => {
    const extensions = [
      numbers ? lineNumbers() : [],
      codeLanguages[language] ?? [],
      syntaxHighlighting(codeHighlight),
      codeTheme,
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      EditorState.readOnly.of(readOnly),
      EditorView.editable.of(!readOnly),
      EditorView.contentAttributes.of({
        'aria-label': label,
        spellcheck: 'false',
        autocapitalize: 'off',
        ...(readOnly ? { 'aria-readonly': 'true', tabindex: '0' } : { 'aria-multiline': 'true' }),
      }),
      hint ? placeholder(hint) : [],
      maxLength ? EditorState.changeFilter.of(transaction => transaction.newDoc.length <= maxLength) : [],
      readOnly
        ? []
        : [
            history(),
            bracketMatching(),
            closeBrackets(),
            complete ? autocompletion({ override: [complete], activateOnTyping: true, icons: false }) : [],
            keymap.of([{ key: 'Tab', run: acceptCompletion }, ...defaultKeymap, ...historyKeymap]),
          ],
      EditorView.updateListener.of(update => {
        if (update.docChanged && !update.transactions.some(transaction => transaction.annotation(external))) {
          change.current?.(update.state.doc.toString());
        }
      }),
    ];
    const editor = new EditorView({ doc: value, parent: host.current, extensions });
    view.current = editor;
    if (viewRef) viewRef.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
      if (viewRef) viewRef.current = null;
    };
  }, [language, readOnly, label, hint, numbers, maxLength, complete]);
  useLayoutEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
        annotations: external.of(true),
      });
    }
  }, [value, language, readOnly, label, hint, numbers, maxLength]);
  return <div className="code-surface" ref={host} />;
}

export function CopyButton({ text, label = 'Copy', className = '' }) {
  const [state, setState] = useState('');
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      if (native?.copyText) await native.copyText(text);
      else await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(''), 2000);
  }
  return (
    <button type="button" className={'copy-button ' + state + ' ' + className} onClick={copy}>
      {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}

// Read-only code with a header bar. `copyValue` lets the screen show a masked secret while the clipboard gets the real one.
export function CodeBlock({ value, copyValue, language = 'plain', label, filename, maxHeight = 280, numbers = true }) {
  return (
    <figure
      className="code-block"
      style={{ '--code-max': typeof maxHeight === 'number' ? maxHeight + 'px' : maxHeight }}
    >
      <figcaption>
        <span className="code-lang">{languageNames[language]}</span>
        {filename && <span className="code-file">{filename}</span>}
        <CopyButton text={copyValue ?? value} />
      </figcaption>
      <CodeSurface value={value} readOnly language={language} label={label} numbers={numbers} />
    </figure>
  );
}

function jsonStatus(value) {
  if (!value.trim()) return null;
  try {
    JSON.parse(value);
    return { ok: true, text: 'Valid JSON' };
  } catch (error) {
    return { ok: false, text: String(error.message).replace(/^JSON.parse: /, '') };
  }
}

// Editable code field that replaces a plain textarea. It suggests keywords, types and names as you type,
// closes brackets, and shows a short syntax tip, a JSON check and an optional starter example below.
export function CodeInput({
  value,
  onChange,
  language = 'plain',
  label,
  hint,
  readOnly = false,
  maxLength,
  numbers = true,
  dialect,
  names,
  proposal,
  example,
  tip,
}) {
  const view = useRef(null);
  const complete = React.useMemo(
    () => (readOnly ? null : completionSource(language, { dialect, names, proposal })),
    [language, dialect, names, proposal, readOnly]
  );
  const status = language === 'json' ? jsonStatus(value) : null;
  const note = tip ?? codeTips[language];
  return (
    <div className="code-block code-input">
      <div className="code-head">
        <span className="code-lang">{languageNames[language]}</span>
        <span className="code-label">{label}</span>
        {complete && (
          <button
            type="button"
            className="code-action"
            title="Show suggestions (Ctrl+Space)"
            onClick={() => {
              view.current?.focus();
              if (view.current) startCompletion(view.current);
            }}
          >
            <Lightbulb size={13} />
            Hints
          </button>
        )}
        {language === 'json' && (
          <button
            type="button"
            className="code-action"
            disabled={!status?.ok || readOnly}
            onClick={() => onChange(JSON.stringify(JSON.parse(value), null, 2))}
          >
            Format
          </button>
        )}
      </div>
      <CodeSurface
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        language={language}
        label={label}
        hint={hint}
        numbers={numbers}
        maxLength={maxLength}
        complete={complete}
        viewRef={view}
      />
      {(note || status || (example && !value.trim())) && (
        <div className="code-foot">
          {status ? (
            <span role="status" className={'code-status ' + (status.ok ? 'ok' : 'bad')}>
              <i />
              {status.text}
            </span>
          ) : (
            note && <span className="code-tip">{note}</span>
          )}
          {example && !value.trim() && !readOnly && (
            <button type="button" className="code-action" onClick={() => onChange(example)}>
              Insert example
            </button>
          )}
        </div>
      )}
    </div>
  );
}
