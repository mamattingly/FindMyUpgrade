# WoW Forever Dungeon Advisor

A character-aware dungeon farming planner for WoW Forever.

## Product direction
The primary question is: **Which dungeon gives this character the best return on the time spent running it?**

The planner is designed to combine:
- Useful gear upgrades for the active character.
- Optional Tailoring and Enchanting progression goals.
- Material and disenchant value, once sourced drop tables are validated.
- Dungeon completion-time estimates, once representative run-time data is available.

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
- The current ranking is gear-upgrade focused. Tailoring/Enchanting material weights and dungeon run-time normalization are not yet included because complete, trustworthy data has not been validated.
- Do not interpret the current score as upgrades per hour or a complete profession-farming optimizer.
- Profiles and profession progress are saved locally in the browser; no server-side database is configured.
- Render's free service may sleep after inactivity.
