import React, { useLayoutEffect, useRef } from 'react';
import { acceptCompletion, autocompletion, pickedCompletion, startCompletion } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, insertTab } from '@codemirror/commands';
import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { getHints } from './hints.mjs';

const maxSourceLength = 100_000;
const schemaLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(?:#|\/\/)/)) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return 'string';
    if (stream.match(/^[a-z_]\w*/i)) {
      return /^(database|table|collection|index|primary|charset|collate|pk|required|unique|ref|default|ondelete)$/
        .test(stream.current()) ? 'keyword' : null;
    }
    if (stream.match(/^\d+(?:\.\d+)?/)) return 'number';
    stream.next();
    return null;
  },
});

function completeSchema(dialect) {
  return context => {
    const source = context.state.doc.toString();
    const { start, end, items } = getHints(source, context.pos, dialect);
    if (!items.length) return null;
    return {
      from: start, to: end, filter: false,
      options: items.map(label => ({
        label,
        apply(view, completion, from, to) {
          const next = view.state.doc.sliceString(to, to + 1);
          const hasArguments = next === '(' || next === '[';
          const needsSize = !hasArguments && dialect === 'mysql';
          const size = needsSize && label === 'varchar' ? '(255)' : needsSize && label === 'varbinary' ? '(32)' : '';
          const hasSpace = /[ \t]/.test(next);
          const insert = label + size + (hasSpace || hasArguments ? '' : ' ');
          view.dispatch({
            changes: { from, to, insert },
            selection: { anchor: from + insert.length + Number(hasSpace) },
            annotations: pickedCompletion.of(completion),
            userEvent: 'input.complete',
            scrollIntoView: true,
          });
        },
      })),
    };
  };
}

export function SourceEditor({ source, setSource, dialect }) {
  const host = useRef(null);
  const editor = useRef(null);
  const change = useRef(setSource);
  const extensions = useRef(null);

  useLayoutEffect(() => { change.current = setSource; }, [setSource]);
  useLayoutEffect(() => {
    extensions.current = [
      lineNumbers(),
      history(),
      schemaLanguage,
      syntaxHighlighting(defaultHighlightStyle),
      EditorState.tabSize.of(2),
      EditorState.changeFilter.of(transaction => transaction.newDoc.length <= maxSourceLength),
      EditorView.contentAttributes.of({
        'aria-label': 'Schema source', 'aria-describedby': 'hint-shortcut',
        spellcheck: 'false', autocapitalize: 'off',
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) change.current(update.state.doc.toString());
      }),
      autocompletion({ override: [completeSchema(dialect)], activateOnCompletion: () => true, interactionDelay: 0 }),
      keymap.of([{ key: 'Tab', run: view => acceptCompletion(view) || insertTab(view) }, ...defaultKeymap, ...historyKeymap]),
    ];
    const view = new EditorView({ parent: host.current, extensions: extensions.current });
    editor.current = view;
    return () => { view.destroy(); editor.current = null; };
  }, [dialect]);

  useLayoutEffect(() => {
    const view = editor.current;
    const doc = source.replace(/\r\n?/g, '\n');
    if (view.state.doc.toString() !== doc) {
      view.setState(EditorState.create({ doc, extensions: extensions.current }));
    }
  }, [dialect, source]);

  return <>
    <div className="editor" ref={host} />
    <div className="syntax-hints">
      <button id="hint-shortcut" onClick={() => {
        editor.current.focus();
        startCompletion(editor.current);
      }}>
        Syntax hints <kbd>Ctrl+Space</kbd>
      </button>
      <span><kbd>Tab</kbd> to accept or indent</span>
    </div>
  </>;
}
