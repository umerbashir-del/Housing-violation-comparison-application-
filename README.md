# Blockwise

Blockwise is a read-only NYC building-record research MVP. It helps renters and researchers compare buildings using the NYC Department of Housing Preservation and Development (HPD) Housing Maintenance Code Violations dataset.

It is not a reporting tool. It does not create, edit, submit, or remove City records.

## What the app does

- Search by full address, building number plus street, ZIP code, or borough.
- Filter records by borough, open status, severity (Class A, B, or C), and problem type.
- Offer address suggestions as someone types.
- Support keyboard navigation for suggestions: Up/Down arrows, Enter, and Escape.
- Offer example searches before a visitor starts typing.
- Group records at the building level to make building comparison easier.
- Show open violations, Class C violations, total matching records, and a map location when NYC provides coordinates.
- Link each result to the official NYC Open Data source.
- Show loading, retry, empty-result, map-unavailable, and common service-error states.
- Reassure visitors when a NYC search remains in progress for more than three seconds.
- Retrieve public data through a small Vercel serverless function rather than calling NYC Open Data directly from every visitor's browser.

## What “live” means

The app asks NYC Open Data for the latest version of the HPD public dataset available at the time of the search. It is not a real-time inspection system and it does not prove a building's current condition.

NYC can update, correct, overwrite, or delay public records. The app displays the dataset's reported update timestamp when available.

## Data source and use

The data comes from NYC Open Data's [Housing Maintenance Code Violations dataset](https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5).

NYC makes its public Open Data datasets available for public use, including applications. This project keeps source attribution and includes a disclaimer because City data is provided for informational purposes and is not guaranteed complete or accurate.

Before a public launch, keep the app's Data & Trust page accurate and get legal advice if you add building scores, paid access, user accounts, advertising, or other use that changes the product substantially.

## Project layout

```text
api/buildings.js       Vercel serverless API: queries, caching, timeouts, basic rate limiting
lib/search.js          Input validation, address normalization, and NYC Open Data query construction
index.html             Main search and comparison interface
app.js                 Browser behavior: search, filters, suggestions, map, loading/error states
styles.css             Site styles
trust.html             Data, privacy, and disclaimer information
test/                  Automated Node tests
TEST_PLAN.md           Manual checks to run before release
vercel.json            Vercel function and security-header configuration
.env.example           Environment-variable template
```

## Requirements

- Node.js 20 or newer
- A Vercel account for deployment
- Optional: an NYC Open Data app token for more reliable upstream access

Install the test dependency before running the included automated tests:

```bash
npm install
```

## Run locally with live data

Do **not** open `index.html` directly or use a basic static-server extension for this project. Those options cannot run the `/api/buildings` backend, so live searches will not work correctly.

From this folder, run:

```bash
npm run dev
```

On Windows PowerShell, use this if `npm` is blocked:

```bash
npm.cmd run dev
```

Vercel will print a local address, usually `http://localhost:3000`. Open that address, then search for an address or ZIP. The first run may ask you to sign in to Vercel or link the folder to your Vercel project. No NYC token is required for live public-data searches.

## Run tests

From this folder:

```bash
node --test
```

On some Windows PowerShell configurations, `npm test` may be blocked by the local execution policy. In that case use the command above, or:

```bash
npm.cmd test
```

The tests cover search normalization, valid/invalid filters, query construction, safe backend responses, public-service failures, suggestions, and rejection of non-read-only API methods.

## Optional local environment variable

Copy the example values into a local environment file only if you need an NYC Open Data token:

```text
NYC_OPEN_DATA_APP_TOKEN=your-token-here
```

Do not commit this token. Do not use a `NEXT_PUBLIC_` prefix. The backend reads it only on the server through `process.env.NYC_OPEN_DATA_APP_TOKEN`.

## Deploy to Vercel

1. Create a new Vercel project and select this `housing-violation-mvp` folder as the project root.
2. In the Vercel project settings, add `NYC_OPEN_DATA_APP_TOKEN` for Preview and Production if you have one.
3. Mark it as sensitive if Vercel offers that option.
4. Deploy a preview first.
5. Run the manual checks in `TEST_PLAN.md` on the preview URL.
6. Add a real public contact email to `index.html` and `trust.html` before production.
7. Promote the verified deployment to production.

The frontend calls `/api/buildings`. The browser never receives the optional NYC token.

## API behavior

`GET /api/buildings`

Accepted query values:

| Name       | Example                 | Purpose                                             |
| ---------- | ----------------------- | --------------------------------------------------- |
| `q`        | `125 Grand St`, `11249` | Address, building number + street, or ZIP code      |
| `borough`  | `BROOKLYN`              | Limits results to a borough                         |
| `status`   | `Open`                  | Shows buildings with one or more open records       |
| `severity` | `A`, `B`, `C`           | Shows buildings with a matching severity            |
| `problem`  | `HEAT`, `MOLD`          | Shows buildings with a matching problem description |
| `page`     | `0`                     | Zero-based page number                              |

`GET /api/buildings?mode=suggest&q=125%20Grand`

Returns up to eight address suggestions. Suggestions are intentionally smaller than regular search results.

The API is read-only: methods other than `GET` return `405 Method not allowed`.

`GET /api/health` returns a small no-cache health response for deployment monitoring. It does not query NYC or expose credentials.

## Reliability and limits

- The Vercel function times out its NYC request after 12 seconds.
- Vercel caches responses for five minutes and can serve stale content briefly while refreshing.
- The function includes a basic per-instance request limit of 30 searches per minute per IP address.
- Backend failures are logged as minimal structured events without the visitor's search text.
- The browser cancels old full searches and old autocomplete searches so slower results do not replace newer ones.

The basic rate limiter is suitable for a small MVP, but is not globally shared across Vercel instances. For higher traffic, replace it with a shared rate-limit service such as Vercel KV or Upstash.

## Maps

The map uses Leaflet and OpenStreetMap tiles. OpenStreetMap attribution is visible in the map. The app uses the official tile URL and includes a map-unavailable fallback.

For normal, low-volume interactive usage this is appropriate. Do not bulk-download, prefetch large areas, or add offline map downloads using OpenStreetMap's public tile server. For substantial traffic, choose a dedicated map-tile provider or host tiles under a suitable agreement.

## Before public launch

- Replace the contact placeholder with an email address you control.
- Read and keep `trust.html` accurate.
- Add the optional NYC Open Data token in Vercel.
- Test a Vercel preview with live NYC data.
- Test known addresses, ZIP pagination, every filter, slow requests, network errors, no results, map failures, keyboard navigation, and mobile layout.
- Decide whether a shared rate limit is needed for expected traffic.
- Review NYC Open Data and OpenStreetMap terms again if the product model changes.

## Important disclaimer

Blockwise is a research aid. It is not a safety rating, a legal opinion, a current-condition guarantee, or a substitute for an in-person inspection. Public records may be incomplete, delayed, or associated with an address differently than a listing.
