import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { useEffect, useMemo, useRef, type ComponentType } from 'react'

/**
 * What the screen needs from an editor: the text, a change, where the caret is,
 * and a way to send the caret somewhere. Kept this narrow so the screen's logic
 * (caret → slide, thumbnail → caret, autosave) is tested with a plain textarea
 * in place of CodeMirror, which does not lay out in a DOM without layout.
 */
export interface EditorProps {
  value: string
  onChange(text: string): void
  /** The caret moved (or the text under it changed); its offset in `value`. */
  onCaret(at: number): void
  /** Put the caret at `at` and scroll to it, once per new `nonce`. */
  jump: { at: number; nonce: number } | null
  theme: 'light' | 'dark'
}

export type Editor = ComponentType<EditorProps>

/** The deck's Markdown in CodeMirror 6, on the module's tokens. */
export function DeckEditor({ value, onChange, onCaret, jump, theme }: EditorProps) {
  const ref = useRef<ReactCodeMirrorRef>(null)
  const caret = useRef(onCaret)
  caret.current = onCaret

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.selectionSet || update.docChanged) caret.current(update.state.selection.main.head)
      }),
    ],
    [],
  )

  useEffect(() => {
    const view = ref.current?.view
    if (!jump || !view) return
    const at = Math.min(jump.at, view.state.doc.length)
    view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 24 }) })
    view.focus()
  }, [jump])

  return (
    <CodeMirror
      ref={ref}
      className="deck-editor h-full"
      height="100%"
      value={value}
      theme={theme}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        autocompletion: false,
      }}
      aria-label="deck markdown"
    />
  )
}
