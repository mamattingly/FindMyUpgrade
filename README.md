# WoW Forever Dungeon Advisor

A React + FastAPI starter for comparing dungeons by expected useful upgrades per hour.

## Stack
- React + Vite frontend
- FastAPI backend
- Browser localStorage for character profiles (no paid database required)
- Render free web service deployment via `render.yaml`

## Run locally
```bash
pip install -r requirements.txt
cd frontend && npm install && npm run build
cd ..
uvicorn backend.main:app --reload
```
Open http://localhost:8000.

## Deploy
Render Blueprint is configured to deploy the Python API and built frontend as one service. It watches `main` and can auto-sync later Git pushes after the initial Blueprint sync is approved.

## Important limitations
This is an initial deployable starter, not yet a complete sourced game database. The ForeverBuilds scanner is best-effort; equipped gear extraction and reliable spec extraction need additional work. No unsourced drop percentages should be treated as verified. Profiles are stored in browser localStorage on that device; no server-side database is configured.

Render's free web service may sleep after inactivity and has limited resources. No paid APIs or database are required by this starter.
