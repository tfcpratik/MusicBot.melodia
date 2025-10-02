<div align="center">

# MusicMaker v16.0 🎶

A next-generation Discord music bot crafted with **discord.js v14**, engineered for cinematic embeds, lossless playback, and frictionless control across desktop and mobile.

![GitHub Stars](https://img.shields.io/github/stars/umutxyp/musicbot?style=social)
![GitHub Forks](https://img.shields.io/github/forks/umutxyp/musicbot?style=social)
![GitHub Issues](https://img.shields.io/github/issues/umutxyp/musicbot)
![GitHub License](https://img.shields.io/github/license/umutxyp/musicbot)

[Invite the public MusicMaker bot](https://discord.com/oauth2/authorize?client_id=774043716797071371&permissions=277028620608&scope=applications.commands%20bot) • [Support Server](https://discord.gg/ACJQzJuckW) • [Website](https://musicmaker.vercel.app)

</div>

---

## ✨ Why MusicMaker?

- **Slash-first UX** – `/play`, `/search`, `/language`, `/nowplaying`, and `/help` respond instantly with localized embeds and live-updating buttons.
- **Platform polyglot** – Streams from YouTube, Spotify, SoundCloud, or a direct MP3/WAV/OGG link. Spotify albums, playlists, and artist radios turn into fully hydrated queues.
- **Adaptive UI** – A two-row control deck (Pause, Skip, Stop, Queue, Shuffle, Volume) stays in sync with the audio engine and locks down expired sessions automatically.
- **Edge-ready audio core** – Preloads entire queues, heals voice reconnections, and falls back gracefully when Discord or upstream services hiccup.
- **Global voice** – 21 fully translated language packs shipped out-of-the-box with instant server switching.
- **Privacy-first** – Stores only the language preference per guild in a local JSON database. No chat logs, no audio recordings.

---

## 🗺️ Table of Contents

1. [Project Highlights](#project-highlights)
2. [Folder Anatomy](#folder-anatomy)
3. [Prerequisites](#prerequisites)
4. [Quick Start](#quick-start)
5. [Configuration](#configuration)
6. [Spotify API Setup](#spotify-api-setup)
7. [Slash Commands & Controls](#slash-commands--controls)
8. [Language Support](#language-support)
9. [Deployment Tips](#deployment-tips)
10. [Troubleshooting](#troubleshooting)
11. [Privacy & Legal](#privacy--legal)
12. [Contributing](#contributing)

---

## Project Highlights

| Capability | Details |
| --- | --- |
| 🎛️ Dynamic Embeds | Auto-refreshing "Now Playing" cards with cover art, platform badges, queue countdowns, and localized metadata. |
| 🪄 Smart Queue | Instant mix-ins, sequential preloading, shuffle with DJ-only guardrails, and playlist collapsing to keep channels tidy. |
| 🛡️ Resilient Playback | Voice connection watchdog, stream retry logic, idle auto-disconnect, and graceful SIGINT shutdown. |
| 🧠 Localization | Cached translations via `node-json-db` with runtime language switching and fallback logic. |
| ⚙️ Extensible Core | Modular providers (`src/YouTube.js`, `src/Spotify.js`, `src/SoundCloud.js`, `src/DirectLink.js`) let you add more sources quickly. |

---

## Folder Anatomy

```
discord-musicbot/
├── commands/           # Slash command handlers (play, help, search, language, ...)
├── events/             # Button & modal controllers for playback UI
├── src/                # Core services: MusicPlayer, MusicEmbedManager, providers
├── languages/          # 21 JSON language packs
├── database/           # node-json-db store for guild language preferences
├── config.js           # Central configuration + env fallbacks
├── index.js            # Bot bootstrap, client wiring, voice auto-cleanup
├── LICENSE             # MIT License
├── PRIVACY_POLICY.md   # Data handling details
└── TERMS_OF_SERVICE.md # Acceptable use guidelines
```

---

## Prerequisites

- **Node.js** ≥ 18 (LTS recommended) and npm.
- **Git** for cloning the repository.
- **Discord application** with a bot user created in the [Discord Developer Portal](https://discord.com/developers/applications).
- *(Optional but recommended)* A VPS or host with stable bandwidth and low latency to Discord voice regions.

> ℹ️ `ffmpeg-static` ships with the project. You do **not** need a system-wide FFmpeg unless you prefer using a custom build.

---

## Quick Start

### Windows fast track

```powershell
# Run from the repo root
.\setup.bat
# Edit the generated .env with your credentials
.\start.bat
```

`setup.bat` verifies Node.js/npm, installs dependencies, and scaffolds a `.env` template if you don’t have one yet. `start.bat` makes sure your environment is ready and launches the bot via `npm run start`.

### Cross-platform manual steps

```powershell
# 1. Clone & enter
git clone https://github.com/umutxyp/musicbot.git discord-musicbot
cd discord-musicbot

# 2. Install dependencies
npm install

# 3. Configure secrets (see below)
Copy-Item .env .env.backup -ErrorAction SilentlyContinue
# Edit .env with your token, client ID, Spotify credentials, etc.

# 4. Boot the bot
npm run start
# or
node index.js
```

Slash commands register automatically when the bot starts. Guild-scoped deployment executes within seconds if `GUILD_ID` is provided; global rollout can take up to an hour per Discord caching rules.

---

## Configuration

MusicMaker reads from both `config.js` defaults and environment variables via `.env`. Update whichever approach fits your hosting workflow.

### `.env` Cheat Sheet

```dotenv
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
GUILD_ID=optional_guild_for_fast_testing
SPOTIFY_CLIENT_ID=spotify_client_id
SPOTIFY_CLIENT_SECRET=spotify_client_secret
STATUS=🎵 MusicMaker | /play
EMBED_COLOR=#FF6B6B
SUPPORT_SERVER=https://discord.gg/ACJQzJuckW
WEBSITE=https://musicmaker.vercel.app
```

### Key Settings

| Setting | Location | Purpose |
| --- | --- | --- |
| `discord.token` | `.env` → `config.discord.token` | Discord bot token used for login and REST registration. |
| `discord.clientId` | `.env` → `config.discord.clientId` | Application ID required to register slash commands. |
| `discord.guildId` | `.env` → `config.discord.guildId` | Optional testing guild ID for <1 minute command deployment. Leave blank for global registration. |
| `bot.status` | `.env`/`config.js` | Activity text shown as "Listening to ...". |
| `bot.embedColor` | `.env`/`config.js` | Hex color for all embeds. |
| `bot.supportServer` & `bot.website` | `.env`/`config.js` | Populates help links and README badges. |
| `spotify.clientId` & `spotify.clientSecret` | `.env`/`config.js` | Enables Spotify search, playlist and album expansion. |

> 🔐 Never commit `.env` to source control. Use deployment secrets in your hosting provider or create environment variables at runtime.

---

## Spotify API Setup

1. Visit the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard/), sign in, and click **Create an App**.
2. Name your integration (e.g., `MusicMaker Bot`) and enable **Web API**.
3. Reveal and copy the **Client ID** and **Client Secret**.
4. Add a redirect URI (any valid URL, e.g., `https://localhost/callback`) – although client credentials flow is used, Spotify requires at least one placeholder.
5. Paste both values into your `.env` (`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`).
6. Restart the bot. The credentials are cached and refreshed automatically with the client credentials grant.

Without these credentials Spotify requests fall back to zero results.

---

## Slash Commands & Controls

| Command | What it does |
| --- | --- |
| `/play <query>` | Smart-detects platform links or search keywords, queues playlists/albums, and spins up the control panel. |
| `/search <keywords>` | Presents a paginated selection menu of YouTube matches — choose with buttons. |
| `/nowplaying` | Drops the live embed again, including queue status, repeat/shuffle flags, and volume. |
| `/language` | Opens a flag button wall for instant localization (cached per guild). |
| `/help` | Gorgeous, localized feature tour + live stats and support links. |

### On-embed Controls

- **⏸️ / ▶️ Pause & Resume** – Auth-limited to DJs, admins, or the original requester.
- **⏭️ Skip** – Jumps to the next queued item (requires at least 1 upcoming track).
- **⏹️ Stop** – Clears queue, tears down voice, and locks the panel.
- **📋 Queue** – Renders the next 10 tracks with real-time progress bar.
- **🔀 Shuffle** – Randomizes the queue with guard rails (min. 2 tracks).
- **🔊 Volume** – Opens a modal allowing 0–100 input.

All button sessions carry a short-lived signature, preventing stale interactions from previous queues.

---

## Language Support

Out-of-the-box translations (and matching flag buttons):

**Arabic**, **German**, **English**, **Spanish**, **French**, **Indonesian**, **Italian**, **Japanese**, **Dutch**, **Portuguese**, **Russian**, **Turkish**, **Traditional Chinese**, **Simplified Chinese**, **Hindi**, **Finnish**, **Danish**, **Norwegian**, **Polish**, **Korean**, **Swedish**

Add your own by copying `languages/en.json`, translating strings, and restarting the bot. The `LanguageManager` hot-loads every JSON file in `languages/`.

---

## Deployment Tips

- **Testing Guild** – Set `GUILD_ID` during development to avoid the global propagation delay. Remove it before production to reach every server automatically.
- **Process Manager** – Use `pm2`, `systemd`, or Docker to keep the bot alive and restart on crashes. Remember to persist the `database/languages.json` file if you containerize.
- **Logging** – Leverage the built-in Chalk-colored console output. Redirect stdout/stderr to log files for long-term monitoring.
- **Scaling** – The bot maintains one voice connection per guild. Horizontal scaling requires a shared state & queue (Redis, REST API, etc.) — future roadmap material.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Slash commands do not appear | Ensure `CLIENT_ID` is correct and the bot logged in successfully. For new deployments, invite the bot with `applications.commands` scope. |
| Spotify tracks return nothing | Verify `SPOTIFY_CLIENT_ID`/`SECRET` and that the app is approved for Spotify Web API. |
| Bot joins but plays silence | Confirm the host has outbound UDP open, and the voice channel permissions allow **Connect** and **Speak**. |
| Buttons stop working mid-song | Interactions expire after Discord’s cache TTL or when a new session is generated. Use `/play` again to refresh the deck. |
| Command language incorrect | Run `/language`, select your flag, and ensure `database/languages.json` is writable. |

---

## Privacy & Legal

- [Privacy Policy](./PRIVACY_POLICY.md) – Exactly what data we store (guild ID + language preference) and how to request deletion.
- [Terms of Service](./TERMS_OF_SERVICE.md) – Acceptable use, liability limits, and contact info.
- [License](./LICENSE) – MIT. Use it privately or commercially — just keep the notice.

---

## Contributing

1. Fork the repository and create a feature branch.
2. Run `npm install` to load dependencies.
3. Add or refine features (translation packs, UI tweaks, new providers).
4. Open a pull request with a clear description and screenshots/console logs where relevant.

Bug reports, feature ideas, and localization pull requests are all welcome. Swing by the [Support Server](https://discord.gg/ACJQzJuckW) to chat with the community.

---

Happy streaming, and keep the servers grooving! 🎧

