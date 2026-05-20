/**
 * MonacoEditor — proxy to the npm-vendored implementation.
 *
 * The real wrapper lives at `./monaco.tsx` (P2-FE-04). This file exists for
 * back-compat with the original capitalized filename used by Engineer B/C
 * imports.
 */

export { MonacoEditor, type MonacoEditorProps } from "./monaco";
