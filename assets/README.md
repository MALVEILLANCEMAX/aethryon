# README media

| File | Source | Notes |
|---|---|---|
| `banner.svg` | Composed from the official owl head and Marcellus logotype outlines (`assets/brand/`) | Animated with CSS inside the SVG; motion stops with `prefers-reduced-motion` |
| `logo.svg` | Official app icon (`assets/brand/aethryon-app.svg`) with the rounded mask operating systems apply | |
| `demo-web.gif` | Excerpt of the official launch film (5.0 s → 9.2 s), 720 px, 15 fps | 1.4 MB |
| `demo-extension.gif` | Excerpt of the official launch film (9.1 s → 15.8 s), 720 px, 12 fps | 2.6 MB |
| `screenshots/site-*.png` | Website built from this repository, local development stack (Playwright, Chromium) | No account, no personal data |
| `screenshots/extension-*.png` | Extension UI in the automated browser tests (test fixtures) | Sample titles only |
| `screenshots/desktop-library.png` | Desktop UI in the browser test harness with sample data | |
| `brand/` | Official brand files used by the README | See `packages/brand` |

Full launch film (38 s, with sound): <https://raccourci.malvu.fr/media/film/aethryon-v35-1080.mp4>.

## Still missing — no staged demos

The following demos must be **real screen recordings**. They are intentionally not replaced by mock-ups.

| Slot | What to record | Rules |
|---|---|---|
| `demo-discord.gif` | In a real Discord client: `/convert` with a public test video you own → private progress → the file or link arrives | Test server and test account only; crop out user names, avatars, server names and member lists |
| `demo-ios.gif` | On a real iPhone: Share › AETHRYON › MP4 → saved to Photos | Hide the status bar, notifications and personal photos; use a video you own |

Recommended pipeline: record 6–10 s, then
`ffmpeg -i in.mov -vf "fps=12,scale=720:-1:flags=lanczos,palettegen=max_colors=128:stats_mode=diff" pal.png` and
`ffmpeg -i in.mov -i pal.png -lavfi "fps=12,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=none:diff_mode=rectangle" out.gif`
(keep each GIF under ~3 MB; link a video instead if it is larger).
