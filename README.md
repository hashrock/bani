# Bani

Convert and lightly edit media files entirely in your browser. Nothing is uploaded, and after the first visit it works offline.

Drop anything on the page: one file opens its editor, several files go to batch conversion.

| Kind | Editor (`#/edit/<kind>`) | Batch conversion (`#/convert`) |
| --- | --- | --- |
| Video | Trim, crop, rotate / flip, mute; export MP4 / WebM / GIF, a still frame, or the audio only | ✓ |
| Audio | Trim, fade, gain / normalize, mono; MP3 / AAC / Opus / WAV / FLAC | ✓ |
| Image | Rotate / flip, crop, resize, padding, background; PNG / JPEG / WebP / AVIF, target file size, metadata removal | ✓ |
| PDF | Reorder / rotate / delete / keep pages, merge PDFs and images, split | — |
| Text & code | Syntax highlighting, encoding / BOM / line-ending conversion, JSON format, Markdown preview, SRT ⇄ VTT | ✓ |
| Archive | Browse and extract ZIP / tar / tar.gz / gzip, create ZIP / tar.gz | — |

Video and audio are powered by [Mediabunny](https://mediabunny.dev). See [ROADMAP.md](./ROADMAP.md) for the shared operation model and what comes next.

## Saving

- **Save** (⌘S) overwrites the file you opened when the output is lossless and in the same format (text, PNG, WAV, FLAC, PDF page edits). Otherwise **Save as…** is the main action, and overwriting stays in the dropdown.
- Overwriting needs the File System Access API (Chrome, Edge). Other browsers download the result instead.
- Batch conversion, PDF splitting and archive extraction save several files at once: **to a folder** (Chrome, Edge; existing files are never overwritten, a number is added instead), **as one ZIP**, or **one by one** as downloads.

## Development

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest (+ fast-check)
pnpm lint
pnpm build
```

### Offline check

`pnpm build` fails if any file in `dist/` is missing from the Service Worker's precache list (`pwa/plugin.ts`, tested in `pwa/plugin.test.ts`). Before a release, also check it in a real browser:

1. `pnpm build && pnpm preview`, open the printed URL in Chrome and wait until DevTools → Application → Service Workers shows the worker as *activated*.
2. DevTools → Network → set **Offline**, then reload. The hub must load, and the service switcher (top right) simply disappears.
3. Still offline, open each editor from the hub (video, audio, image, PDF, text, archive) and batch conversion, drop a file and save it. The Network panel must show no failed requests from this origin (lazy chunks, workers and `.wasm` come from the Service Worker).
4. Go back online, change something, rebuild and reload: the old version keeps running until every tab is closed, then the new one takes over.

<img width="1069" height="851" alt="CleanShot 2025-11-26 at 18 42 17" src="https://github.com/user-attachments/assets/5f17ea4c-d46b-4e58-9dc3-154f37bc3f16" />
