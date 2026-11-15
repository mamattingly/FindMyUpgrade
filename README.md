# WoW Forever Dungeon Advisor

A character-aware dungeon farming planner for WoW Forever.

## Product direction
The primary question is: **Which dungeon gives this character the best return on the time spent running it?**

The planner is designed to combine:
- Useful gear upgrades for the active character.
- Optional Tailoring and Enchanting progression goals.
- Character-specific, measured Tailoring cloth and eligible disenchantable-item yields per hour.
- Gear value per hour using the player's recorded dungeon clear times.

Profession goals are optional. Players who only want gear upgrades should get a simple gear-first recommendation without configuring professions.

## Current stack
- React + Vite frontend.
- FastAPI backend with asynchronous HTTPX requests to Blizzard and item-data sources.
- Character profiles, skill levels and preferences stored in browser localStorage.
- Render deployment with a built frontend served by the API.

## Run locally
```bash
pip install -r requirements.txt
cd frontend && npm install && npm run build
cd ..
uvicorn backend.main:app --reload
```

Open http://localhost:8000.

## Performance approach
The current workload is dominated by remote Blizzard and item-data requests, not Python CPU time. The backend uses async HTTP, bounded concurrency, and process-level item caching. A runtime rewrite should only be undertaken if repeatable end-to-end benchmarks show that it materially improves latency or operating cost; switching languages alone will not make upstream APIs respond faster.

## Data integrity and current limitations
- Character, equipped gear and item stats are sourced from Blizzard/Forever-compatible data.
- Dungeon loot mappings are sourced from the AllTheThings Forever dataset.
- Stat weights are estimates, not a full combat simulator.
- Dungeon loot drop tables do not currently provide complete trash-cloth yields or verified clear times. The app therefore asks players to log their own runs (minutes, cloth collected, eligible disenchantable items) and ranks measured yield rates alongside stat-weighted gear value.
- Tailoring cloth/hour and disenchantable items/hour are measured yield proxies, not guaranteed profession skill-ups or disenchanting material values. Dungeons without logged runs are excluded from a measured comparison.
- Until enough runs are logged, the app falls back to the sourced gear-upgrade baseline and clearly labels that limitation.
- Profiles and profession progress are saved locally in the browser; no server-side database is configured.
- Render's free service may sleep after inactivity.
