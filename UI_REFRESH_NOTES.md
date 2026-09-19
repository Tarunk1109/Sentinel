# Light UI refresh

Branch: `codex/light-ui-refresh`, based on Claude's clean main at `cc5a95e`.

The interface now uses warm ivory, plum, sage and coral; a custom decorative product illustration; softer cards; clearer typography; subtle entry, hover and button motion; and reduced-motion support. The existing locally bundled Geist fonts are retained. No new packages or external image/font requests were added.

The home page introduces the three modes in plain language. Results and activity appear once a request begins, and the existing checkout/sandbox entry remains available through a collapsed disclosure. Request examples still only populate the input. Inspect retains both camera capture and upload. Build's optional constraints now appear before its Analyze action.

Backend services, hooks, model configuration, commerce integration, camera behavior and purchase guards are unchanged. Claude's completed work is preserved; this pass is a presentation update, not a backend audit.

## Verification

- 376 existing automated tests passed across 24 suites, including 26 navigation/camera checks.
- ESLint, TypeScript and production build passed.
- Secret scan covered source, browser build artifacts and Git history, with zero matches for configured secrets.
- Browser checks: Request example fill, Request/Inspect/Build navigation, accessible checkout disclosure, and no browser console errors observed.
- No horizontal document overflow at 390px (all three modes), 768px (Request), or 1440px (Request).
- Upload/camera behavior is covered by automated tests. Chrome automation could not attach the synthetic test image because the extension's file-URL permission is disabled; browser image-preview/Build-constraints verification remains limited by that permission.
- No live model analysis, Agnic discovery, checkout quotes, dispatch or purchases were triggered during this UI work.

Development preview: `http://127.0.0.1:3000/` while the existing local dev server is running. The old process on port 3001 may show an earlier production build; use port 3000 for this refresh.
