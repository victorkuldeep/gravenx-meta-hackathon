# lib/jsonql — vendored JsonQL engine

Source: `D:\Projects\Node\JsonQL\src` (json-query-lite 1.0.0, MIT, same author).
Vendored on 2026-10-20. Only change from upstream: ESM `.js` import
suffixes stripped (`./types.js` → `./types`) to match this repo's
extensionless imports. No logic touched.

Full engine kept on purpose - architects use aggregates (SUM/AVG/MIN/MAX/
COUNT + groupBy), BM25 scoring, and ORDER BY directly on pulled results.

## Re-sync

Copy `src/*.ts` over these files, re-strip the suffixes, run
`npx tsc --noEmit`. If upstream added modules, copy those too.

## Used through

`lib/queryFilter.ts` - engine cache + filter/aggregate adapter for the
Query tab. UI lazy-loads it so the home bundle never pays for it.
