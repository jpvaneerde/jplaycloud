# JPlay

A music year-guessing game that runs in the browser. The laptop running JPlay plays the songs through Spotify
(Premium) without showing what's playing. Players place blank cards on the table and fill in the year when it's
revealed. The app tracks whose turn it is and everyone's tokens (skip, steal, earn).

Live at https://jplay.cloud. The image is `ghcr.io/jpvaneerde/jplay`. Deployment manifests are in
`jpvaneerde/argocd` under `apps/jplay`.

## How it fits together

One Node server (`server/`) does two jobs. It serves the web app (`src/`, built by Vite) and runs the API under `/api`:
accounts, invites, sign-in and the shared playlists. Data lives in one SQLite file, `$DATA_DIR/jplay.db`.

- **Accounts are invite-only.** Every player can create 5 invites. Admins have no limit and manage everyone under
  Admin → Users.
- **Sign-in** works with an email and password, or with single sign-on: Google, Microsoft, or any OpenID Connect
  provider. A new single sign-on user still needs an invite. If the provider confirms an email that matches an
  existing account, the two are linked automatically.
- **The first admin:** register with the address in `ADMIN_EMAIL`. That's allowed without an invite as long as there
  is no admin yet.
- **Spotify** is connected separately in the browser on the laptop that plays the music, using PKCE (no client
  secret). The shared Spotify app is in Development Mode, so only 5 listed Spotify accounts can use it. Anyone
  else can enter the client ID of their own free Spotify app under Settings → Spotify. The page has step-by-step
  instructions, and the ID is saved with their JPlay account.

## Run it locally

```sh
npm install
npm run dev:server   # API on :8787, data in ./data, ADMIN_EMAIL defaults to admin@example.com
npm run dev          # web app on http://127.0.0.1:5173 (Spotify only accepts 127.0.0.1, not localhost)
```

## Settings (environment variables)

| Variable | Default | What it does |
| --- | --- | --- |
| `PUBLIC_URL` | `http://127.0.0.1:5173` | The address people use. Used for invite links, single sign-on redirects and secure cookies. |
| `ADMIN_EMAIL` | none | This email is always an admin and can register the first account without an invite. |
| `DATA_DIR` | `./data` | Where `jplay.db` is kept. |
| `INVITES_PER_USER` | `5` | Invites a new player gets. |
| `INVITE_DAYS` / `SESSION_DAYS` | `14` / `30` | How long invites and logins last. |
| `GAME_KEEP_DAYS` | `7` | How long a game in progress is kept after the last turn. |
| `OIDC_GOOGLE_CLIENT_ID` / `_SECRET` | none | Turns on "Log in with Google". |
| `OIDC_MICROSOFT_CLIENT_ID` / `_SECRET` | none | Turns on "Log in with Microsoft". |
| `OIDC_MICROSOFT_TENANT` | `common` | Use a tenant ID to allow only your own directory. |
| `OIDC_PROVIDERS` | none | JSON list for other providers: `[{"id","label","issuer","clientId","clientSecret"}]` |

The redirect URI to register with each provider is `PUBLIC_URL/api/auth/oidc/<id>/callback`, for example
`https://jplay.cloud/api/auth/oidc/google/callback`.

## Playlists

Admins make playlists under **Admin → Playlists**, starting from an AI-generated list, Spotify links or one of their
own Spotify playlists, or a JSON file. Every player sees the published ones when setting up a game. Use
**Download JSON** to back a playlist up or move it to another JPlay. The file format:

```json
{
  "name": "80s and 90s party",
  "description": "",
  "songs": [
    { "uri": "spotify:track:…", "title": "Song title", "artist": "Artist feat. Guest", "year": 1984 }
  ]
}
```

### How songs are checked

1. **Spotify search** scores each result on title, artist and year. It penalises live, karaoke, cover, remix and
   re-recorded versions and compilations.
2. **The year** is the earliest first-release date in MusicBrainz, looked up by the track's ISRC and by a title
   search. MusicBrainz allows about one request per second.
3. **Titles** are cleaned ("– Remastered 2011", "(feat. X)", "[Single Version]" are removed). Featured artists
   from Spotify are shown as "Main feat. Guest".
4. **Each song gets a colour.** 🟢 means sources agree. 🟡 means a 1-year difference or a doubtful version.
   🔴 means no match or a big conflict, and red songs are left out when saving. Use **Listen**, pick another
   version, or type the right year (that marks the song checked).

## Game rules in the app

- Everyone gets a random start year (unique by default) and the starting tokens.
- **Skip** costs a token and gives the same player a new song.
- **Steal** works before the reveal. Any other player with a token can mark a steal, which spends the token.
  Tap again before the reveal to undo it.
- **Reveal** flips the card. If the player named the title and artist, they get +1 token (up to the cap).
  Optionally, stealers can earn one too.
- The small −/+ buttons on each player fix token counts by hand.
- **Keyboard:** Space = play/pause, R = reveal, S = skip, N = next turn, Enter = reveal, then next.

All of this can be changed under Game options.

**Saved games:** a game in progress is saved after every move, both in the browser and on the JPlay server under
your account. After a crash, a reload, or a log-in on another computer, JPlay offers to continue where you left off.
The save is deleted when you end the game, or 7 days after the last turn (`GAME_KEEP_DAYS`).

## Deploy

Pushing to `main` builds `ghcr.io/jpvaneerde/jplay:latest` and `:sha-<commit>`. Before pushing the image, the
workflow type-checks the code and runs a quick server test. In the cluster it runs as one pod: the SQLite database
needs a single ReadWriteOnce volume. The pod uses a Longhorn volume mounted at `/data`, and single sign-on secrets
come from the optional `jplay-oidc` secret. The manifests are in `jpvaneerde/argocd` under `apps/jplay`.

To roll out a new `latest`:

```sh
kubectl -n jplay rollout restart deployment/jplay
```

**Backups:** take a Longhorn snapshot or backup of `jplay-data`. For a one-off copy, make a consistent copy inside
the pod, then fetch it:

```sh
kubectl -n jplay exec deploy/jplay -- node -e "new (require('node:sqlite').DatabaseSync)('/data/jplay.db').exec(\"VACUUM INTO '/tmp/jplay-backup.db'\")"
kubectl -n jplay cp "$(kubectl -n jplay get pod -l app=jplay -o name | cut -d/ -f2)":/tmp/jplay-backup.db ./jplay-backup.db
```
