# Random Plex Episode (Node.js)

Play a random episode from a Plex collection to one or more Plex clients.

## Project Status
- Node.js only project
- Single command run: `npm start`

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
3. Follow the prompts. The setup script shows discovered clients, libraries, and collections, and you can pick by name or number (clients also support ranges like `1-3`) before it saves the generated `.env`.

Manual alternative:
```bash
cp .env.example .env
```

## Run
```bash
npm start
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
