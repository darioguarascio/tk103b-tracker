# TK103B Tracker

Open-source GPS tracker dashboard for TK103B devices — live map, trip replay, and event history backed by PostGIS.

**Documentation:** https://darioguarascio.github.io/tk103b-tracker/

## Features

- **Live tracking** — real-time positions over SSE; map follows the vehicle
- **Trip replay** — video-style playback bar with play/pause, speed (1×–16×), and timeline scrubber
- **Event filtering** — toggle move, acc on/off, alarms, and other packet types
- **Date ranges** — presets (last day, week, month…) or custom from/to
- **Mobile layout** — map-first UI with controls drawer and events bottom sheet
- **Optional auth** — password-protect the UI via `AUTH_PASSWORD`

## Quick start

```bash
cp examples/.env.example .env
# edit DATABASE_URL, AUTH_* as needed

docker compose -f examples/docker-compose.yml --profile init run --rm db-init
docker compose -f examples/docker-compose.yml up -d
```

Requires an external PostGIS database. Images: `darioguarascio/tk103b-tracker` and `darioguarascio/tk103b-tracker-ingest` (default tag `latest`).

Full setup: [GitHub Pages setup guide](https://darioguarascio.github.io/tk103b-tracker/setup.html).

## Development

```bash
npm install && npm run init-db && npm run dev
```

API on port 3001, Vite UI on port 5173 (proxies `/api`).

## License

MIT
