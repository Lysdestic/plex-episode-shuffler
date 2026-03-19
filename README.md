# Random Plex Episode (Node.js)

Play a random episode from a Plex collection to one or more Plex clients.

## Project Status

- Node.js only project
- CLI run mode: `npm start`
- Webhook run mode for Home Assistant: `npm run webhook`

## Features

- Uses Plex API directly (no Python runtime required)
- Requires explicit client selection
- Supports simulcast to multiple clients
- Discovers clients from your server and Plex resources
- Basic unit tests for config and matching logic

## Requirements

- Node.js 20+
- Plex server URL + token

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your env file:
   ```bash
   npm run setup
   ```
3. Follow the prompts. The setup script shows discovered clients, libraries, and collections, and you can pick by name or number (clients also support ranges like `1-3` and `*` for all) before it saves the generated `.env`.

Manual alternative:

```bash
cp .env.example .env
```

## Run

```bash
npm start
```

## Webhook Mode (Home Assistant)

Run webhook mode so Home Assistant can trigger playback:

```bash
npm run webhook
```

### Docker Compose

Run as a persistent container service:

```bash
cp .env.example .env  # if needed, then edit values
docker compose up -d --build
```

Useful commands:

```bash
docker compose logs -f
docker compose restart
docker compose down
```

When running via Docker, Home Assistant should call:

- `http://<docker-host-ip>:8787/play`

Optional env vars for webhook mode:

- `PLEX_WEBHOOK_HOST` (optional): bind address, default `0.0.0.0`
- `PLEX_WEBHOOK_PORT` (optional): port, default `8787`
- `PLEX_WEBHOOK_TOKEN` (optional but recommended): bearer/header/query token required for `/play`

Endpoints:

- `GET /health`: health + in-flight status
- `POST /play`: trigger one random-episode playback run

Home Assistant example (`configuration.yaml`):

```yaml
rest_command:
  plex_collection_shuffle:
    url: "http://YOUR_HOST_IP:8787/play"
    method: POST
    headers:
      authorization: "Bearer YOUR_WEBHOOK_TOKEN"
```

Automation example:

```yaml
automation:
  - alias: Play random Plex episode
    trigger:
      - platform: state
        entity_id: input_button.play_random_plex
    action:
      - service: rest_command.plex_collection_shuffle
```

## Test

```bash
npm test
```

## Environment Variables

- `PLEX_URL` (required): Example `http://host:32400`
- `PLEX_TOKEN` (required): Plex auth token
- `PLEX_CLIENTS` (required): Comma-separated client hints, e.g. `Living Room,Bedroom`
- `PLEX_CLIENT` (optional legacy): Single client hint; used only when `PLEX_CLIENTS` is not set
- `PLEX_LIBRARY` (required): Library title, e.g. `TV Shows`
- `PLEX_COLLECTION` (required): Collection title
- `PLEX_SHUFFLE_CONTINUOUS` (optional): `true`/`false`, default `true`
- `PLEX_WEBHOOK_HOST` (optional): Host bind for webhook mode, default `0.0.0.0`
- `PLEX_WEBHOOK_PORT` (optional): Port for webhook mode, default `8787`
- `PLEX_WEBHOOK_TOKEN` (optional): Required token for `/play` if set

## Notes

- Matching is case-insensitive and partial by client title.
- If a hint matches no clients, the run fails with available-client output.
- Playback starts at a random episode, then continues through a shuffled queue of the collection.
- If shuffled-continuous playback fails on all clients, the app retries automatically with the legacy single-episode queue.
- Playback continues if at least one selected client succeeds; failures are reported.

## Troubleshooting

- If playback fails with direct `fetch failed` and proxy `404`, your target client is discoverable but not currently controllable.
- Open the Plex app on the target device and keep it active, then run again.
- Set `PLEX_SHUFFLE_CONTINUOUS=false` to force legacy single-episode queue behavior.
