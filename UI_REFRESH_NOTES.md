# Corporate light workspace

Branch: `codex/light-ui-refresh`, based on Claude's clean main at `cc5a95e`.

The interface uses cool white/slate surfaces, deep ink typography, teal Request accents, blue Inspect accents and bronze Build accents. A persistent desktop sidebar groups the three modes with plain-language descriptions, while smaller screens use a horizontal mode selector. The header includes workspace breadcrumbs, Quick start, integration status and help. Cards, upload surfaces, product results and activity panels share a restrained border and spacing system. Custom decorative SVG illustrations, subtle motion and reduced-motion support are retained. Small-text colors and the Build action color were darkened after a contrast review. The existing locally bundled Geist fonts are retained. No new packages or external image/font requests were added.

The home page introduces the three modes in plain language. A split desktop composition puts the request form beside the introduction, with a stacked mobile layout. Each mode has a distinct accent, active navigation state and matching illustration. Illustrated mode cards add hover motion, and Inspect/Build pair their introduction with the upload surface on desktop. Results and activity appear once a request begins, and the existing checkout/sandbox entry remains available through a collapsed disclosure. Request examples still only populate the input. Inspect retains both camera capture and upload. Build's optional constraints now appear before its Analyze action.

A Quick start dialog opens from the header or Command/Control+K. It filters modes and existing examples, supports Enter and Escape, and fills/focuses the request input without submitting. It uses the existing accessible Radix dialog and is disabled during a shared request run.

Backend services, hooks, model configuration, commerce integration, camera behavior and purchase guards are unchanged. Claude's completed work is preserved; this pass is a presentation update, not a backend audit.

## Verification

- 383 automated tests passed across 25 suites, including the existing navigation/camera checks and seven Quick start interaction checks.
- ESLint, TypeScript and production build passed.
- Secret scan covered source, browser build artifacts and Git history, with zero matches for configured secrets.
- Browser checks for the corporate refresh: desktop and phone Request/Inspect/Build navigation, example fill with input focus, desktop/phone/tablet visual inspection, and no browser console warnings or errors observed. The previous pass also verified Quick start filtering, Control+K, Escape focus restoration and the checkout disclosure; their behavior is unchanged.
- No horizontal document overflow at 390px (all three modes), 768px (Request), or 1470px (Request).
- Upload/camera behavior is covered by automated tests. Chrome automation could not attach the synthetic test image because the extension's file-URL permission is disabled; browser image-preview/Build-constraints verification remains limited by that permission.
- No live model analysis, Agnic discovery, checkout quotes, dispatch or purchases were triggered during this UI work.

Development preview: `http://127.0.0.1:3000/` while the existing local dev server is running. The old process on port 3001 may show an earlier production build; use port 3000 for this refresh.
