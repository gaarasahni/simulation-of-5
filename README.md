# Species Ascendancy Simulator

A free Node.js + Express civilization simulator for Replit.

The world starts from primitive civilizations, evolves automatically, and posts major events to both the website and a Discord webhook.

## What it does

- Runs a huge 20×20 world simulation automatically
- Advances time at **1 real second = 10 hours 9 minutes** in the simulation
- Evolves five species from scratch
- Streams live updates to the website with Server-Sent Events
- Sends major events to one Discord webhook
- Uses only free technologies:
  - Node.js
  - Express
  - Vanilla HTML/CSS/JS
  - Discord incoming webhooks

## Species

The simulation includes five evolving factions inspired by the original design:

- **Granite Colossi** — heavy brute-force civilization
- **Swarmveil Brood** — fast-expanding swarm species
- **Whisper Crown** — stealthy manipulator faction
- **Iron Bastions** — artillery and fortress builders
- **Shifting Chimeras** — adaptive counter-biology

They begin as primitive populations and progress through stages like spark, tribe, kingdom, empire, and beyond.

## Features

- Automatic simulation loop
- Start / pause / reset controls
- Manual single-step button for testing
- Live event feed on the page
- Discord webhook posting for major events
- Species status cards with:
  - population
  - resources
  - territory
  - morale
  - stage
  - strategy
- Large procedural world with sectors, climate, fortification, and devastation values

## Requirements

- Node.js 18 or newer
- A Discord incoming webhook URL
- Replit account if you want to host it there

## Run locally

```bash
npm install
npm start
```

Then open:

```bash
http://localhost:3000
```

## Run on Replit

1. Create a new Node.js Replit.
2. Upload the project files.
3. Run `npm install`.
4. Click **Run**.
5. Open the web preview.
6. Paste your Discord webhook URL into the field on the page and click **Save**.

## Discord webhook setup

1. In Discord, open the channel you want to receive updates.
2. Create an incoming webhook.
3. Copy the webhook URL.
4. Paste it into the simulator UI and save it.

You can also set it as an environment variable:

```bash
DISCORD_WEBHOOK_URL=your_webhook_url_here
```

## API endpoints

### `GET /api/state`
Returns the full simulation state as JSON.

### `GET /events`
Live stream of state updates using Server-Sent Events.

### `POST /api/control`
Controls the simulation.

Supported actions:

- `start`
- `pause`
- `toggle`
- `reset`

Example body:

```json
{ "action": "pause" }
```

### `POST /api/config`
Saves the Discord webhook URL.

Example body:

```json
{ "webhookUrl": "https://discord.com/api/webhooks/..." }
```

### `GET /api/config`
Returns whether a webhook is currently configured.

### `POST /api/step`
Forces one simulation step manually.

## Simulation notes

- The world is intentionally large so wars can spread across many sectors.
- The simulation is mostly logical, but still generates dramatic narrative events.
- Major events are mirrored to Discord.
- The website shows the same live history in the event feed.
- The simulation is designed to be self-contained and not require paid AI APIs.

## File structure

```text
species-sim/
├─ package.json
├─ README.md
└─ public/
   ├─ index.html
   └─ server.js
```

## Free hosting note

This project is designed to work well on Replit's free tier, but free hosting platforms may still impose limits on uptime or deployment duration. For best results, keep the app lightweight and avoid adding paid services.

## License

Use it however you like.
