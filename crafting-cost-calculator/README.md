# Forever Forge

A standalone WoW: Forever crafting-cost workbench. Built with Next.js App Router, React 19, TypeScript and server-side Blizzard OAuth.

## Stack
- Next.js 15 App Router / React 19 / TypeScript
- Server-only Blizzard OAuth credentials; no secrets in the browser
- Blizzard `static-forever-{region}` profession and recipe endpoints
- Blizzard `dynamic-forever-{region}` ruleset auction snapshots
- Route-level caching and responsive custom design

## Run locally
1. Copy `.env.example` to `.env.local`.
2. Add a Battle.net API client ID and secret from https://develop.battle.net/access/.
3. Run `npm install` and `npm run dev`.

## Render
Create a Node web service pointed at the `crafting-cost-calculator` root directory. Build: `npm install && npm run build`. Start: `npm start`. Add the two Blizzard credentials as secret environment variables, plus optional region, locale and ruleset values.

## Data integrity
The Blizzard Forever endpoints are community-discovered and not yet formally documented by Blizzard. Endpoint availability and payloads may change. Auction data is a snapshot of listed buyouts, not completed sales. This initial UI/API scaffold deliberately labels its data source and does not fabricate a price when a quote is missing.
