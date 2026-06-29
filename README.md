# TK103B Tracker

Open-source GPS tracker dashboard for TK103B devices.

**Documentation:** https://darioguarascio.github.io/tk103b-tracker/

## Quick start

```bash
# see examples/ for sample docker-compose and .env
cp examples/.env.example .env
docker compose -f examples/docker-compose.yml --profile init run --rm db-init
docker compose -f examples/docker-compose.yml up -d
```

Requires an external PostGIS database. Full setup guide on [GitHub Pages](https://darioguarascio.github.io/tk103b-tracker/setup.html).

## Development

```bash
npm install && npm run init-db && npm run dev
```

## License

MIT
