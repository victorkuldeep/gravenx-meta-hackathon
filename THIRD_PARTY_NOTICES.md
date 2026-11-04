# Third-party notices

## Excalidraw (Draw engine)

- Package: `@excalidraw/excalidraw` (exact pin `0.18.1`, see `package.json` / `package-lock.json`)
- License: **MIT** (as declared in the package's `package.json` and the npm registry)
- Source: <https://github.com/excalidraw/excalidraw>
- Integrated as an unmodified npm dependency rendered through our own
  `components/draw/DrawCanvas.tsx` adapter. No source is copied into this
  repository, `node_modules` is not modified, and no private fork exists.
- Runtime assets (fonts, locales) are copied verbatim from the installed
  package's `dist/prod` tree into `public/excalidraw-assets/` at build time by
  `scripts/copy-excalidraw-assets.mjs` and served from our own origin. The
  fonts ship inside the MIT-licensed package; no replacement fonts are used.

Required MIT notice (software distributed with this application):

> This software contains Excalidraw, MIT licensed. The MIT license requires
> this notice: "THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY
> KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
> MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT."
> See <https://github.com/excalidraw/excalidraw/blob/master/LICENSE> for the
> full license text.

## Wireframe icon glyphs (Lucide + two vendored brands)

- UI glyphs render from the **`lucide-react` npm package** (ISC):
  <https://lucide.dev> — pinned in `package.json` / `package-lock.json`,
  imported statically per glyph in `components/wireframe/WireIcon.tsx` so
  bundlers tree-shake to only the glyphs on the palette.
- GitHub brand mark follows **Octicons** (MIT, GitHub): <https://primer.style/octicons>
- LinkedIn brand mark follows **Simple Icons** (CC0 1.0 Universal):
  <https://simpleicons.org>
- Only the two brand marks are vendored as path data in
  `lib/wireframe/icons.ts` (Lucide no longer ships brand icons); everything
  renders as inline SVG from our own origin.

Required ISC notice (Lucide):

> "THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT."

Required MIT notice (Octicons):

> "THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT."

## Tiptap (ADR Decision rich-text editor)

- Packages: `@tiptap/react` + `@tiptap/starter-kit` +
  `@tiptap/extension-highlight` + `@tiptap/extension-underline` +
  `@tiptap/extension-text-align` + `@tiptap/extension-text-style` +
  `@tiptap/extension-color` + `@tiptap/extension-font-family` (exact pin
  `3.31.4`, see `package.json` / `package-lock.json`)
- License: **MIT** (as declared in the packages' `package.json`)
- Source: <https://github.com/ueberdosis/tiptap>
- Integrated as unmodified npm dependencies rendered through our own
  `components/decisions/RichTextEditor.tsx` adapter. Bundled with the app —
  no CDN, no external requests. Stored Decision HTML is allowlist-sanitized
  by `lib/decisions/richtext.ts`; packs and AI read back tag-free text.

Required MIT notice (Tiptap):

> "THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT."

## Mammoth (Word .docx import)

- Package: `mammoth` (exact pin `1.13.0`, see `package.json` /
  `package-lock.json`)
- License: **BSD-2-Clause** (as declared in the package's `package.json`)
- Source: <https://github.com/mwilliamson/mammoth.js>
- Integrated as an unmodified npm dependency behind our own
  `lib/notes/docxImport.ts`. It lazy-loads in the import chunk only when
  the architect picks a file - never in the main bundle. Converted HTML
  passes through the same `lib/decisions/richtext.ts` allowlist as pasted
  content before it becomes a note.

Required BSD-2-Clause notice (Mammoth):

> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
> ARE DISCLAIMED.
