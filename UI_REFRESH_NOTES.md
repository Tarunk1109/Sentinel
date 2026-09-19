# Color and motion refresh

Branch: `codex/light-ui-refresh`, based on Claude's clean main at `cc5a95e`.

The interface now uses violet/cobalt for Request, teal for Inspect and coral for Build. Color carries through active navigation, hero surfaces, form actions, mode cards, quick start, results and the process strip. The home hero includes an original CSS/SVG intelligence illustration with a rotating material, orbiting dots, floating concept labels and moving connector dashes. Product illustrations gently float. These are decorative visuals, not fabricated agent activity or commerce results. A header pause/resume control stops ambient motion across modes, and the existing reduced-motion preference disables it.

The existing locally bundled Geist fonts are retained. No new packages or external image/font requests were added.

The home page introduces the three modes in plain language. A split desktop composition puts the request form beside the introduction, with a stacked mobile layout. Each mode has a distinct accent, active navigation state and matching illustration. Illustrated mode cards add hover motion, and Inspect/Build pair their introduction with the upload surface on desktop. Results and activity appear once a request begins, and the existing checkout/sandbox entry remains available through a collapsed disclosure. Request examples still only populate the input. Inspect retains both camera capture and upload. Build's optional constraints now appear before its Analyze action.

A Quick start dialog opens from the header or Command/Control+K. It filters modes and existing examples, supports Enter and Escape, and fills/focuses the request input without submitting. It uses the existing accessible Radix dialog and is disabled during a shared request run.

Backend services, hooks, model configuration, commerce integration, camera behavior and purchase guards are unchanged. Claude's completed work is preserved; this pass is a presentation update, not a backend audit.

## Verification

- 384 automated tests passed across 25 suites, including the existing navigation/camera checks and seven Quick start interaction checks and a new cross-mode motion-control regression test.
- ESLint, TypeScript and production build passed.
- Secret scan covered source, browser build artifacts and Git history, with zero matches for configured secrets.
- Browser checks for the color and motion refresh: all decorative animation play states switch between running and paused; desktop and phone Request/Inspect/Build navigation, example fill with input focus, desktop/phone/tablet visual inspection, and no browser console warnings or errors observed. Earlier passes also verified Quick start filtering, Control+K, Escape focus restoration and the checkout disclosure; their behavior is unchanged.
- No horizontal document overflow at 390px (all three modes), 768px (Request), or 1470px (Request).
- Upload/camera behavior is covered by automated tests. Chrome automation could not attach the synthetic test image because the extension's file-URL permission is disabled; browser image-preview/Build-constraints verification remains limited by that permission.
- No live model analysis, Agnic discovery, checkout quotes, dispatch or purchases were triggered during this UI work.

Development preview: `http://127.0.0.1:3000/` while the existing local dev server is running. The old process on port 3001 may show an earlier production build; use port 3000 for this refresh.
