# Blockwise release test plan

All tests are read-only: they use mocked inputs or `GET` requests only. They never submit, alter, or delete NYC records.

## Automated coverage

- Address normalization: `St`, `Ave`, and other common street abbreviations.
- ZIP, address, borough, severity, status, and problem-type validation.
- Query escaping and bounded page values.
- Server-side grouping and pagination query construction.

Run locally with `node --test` (or `npm.cmd test` on Windows environments that block PowerShell scripts).

## Release checks

1. Search a known full address, then confirm a valid result and official source link.
2. Search a ZIP with no filters; use Next and Previous to confirm pagination.
3. Search each borough and each violation class.
4. Enter an invalid address and confirm input guidance rather than an error card.
5. Test no-match filters and confirm the empty-results message.
6. Temporarily block network access and confirm the connection error and Retry action.
7. Simulate a slow API response and confirm the spinner, animated dots, and timeout message.
8. Block map tiles and confirm records remain usable with the map fallback.
9. Check keyboard autocomplete: Down/Up arrows move, Enter selects, and Escape closes suggestions.
10. Check visible focus, small-screen layout, spinner/dot animation, and a screen reader announcement for loading/errors.
11. Deploy to a Vercel preview; confirm `/api/buildings` works without exposing `NYC_OPEN_DATA_APP_TOKEN` in browser source or network requests.
12. On the preview, confirm OpenStreetMap tiles load and the map attribution remains visible.
