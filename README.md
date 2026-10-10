# JPlay

A music year-guessing game that runs in the browser. The laptop running JPlay plays the songs through Spotify
(Premium) without showing what's playing. Players place blank cards on the table and fill in the year when it's
revealed. The app tracks whose turn it is and everyone's tokens (skip, steal, earn).

Live at https://jplay.cloud. The image is `ghcr.io/jpvaneerde/jplay`. Deployment manifests are in
`jpvaneerde/argocd` under `apps/jplay`.

## Run it locally

```sh
npm install
npm run dev        # http://127.0.0.1:5173 (Spotify only accepts 127.0.0.1, not localhost)
```

The Spotify app (client ID `9ae51a4e1077421b9c7088109205190b`) has these redirect URIs:
`https://jplay.cloud/callback` and `http://127.0.0.1:5173/callback`. To use another client ID, set
`VITE_SPOTIFY_CLIENT_ID` at build time. There is no client secret: login uses PKCE in the browser.

In Development Mode only Spotify accounts on the app's user list (max 5) can log in. Add them under
User Management in the Spotify developer dashboard.

## Playlists

- **Bundled playlists** live in `public/playlists/*.json`, listed in `public/playlists/index.json`.
  They're part of the image, so everyone sees them.
- **Browser playlists** are made in the app (Playlists → Save) and stay in that browser.

Make a playlist in the app, either from an AI list or from Spotify links, then use **Download JSON**. To bundle
it, drop the file into `public/playlists/`, add its filename to `index.json`, and push.

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

All of this can be changed under Game options. The game survives a page reload.

## Deploy

Pushing to `main` builds and pushes `ghcr.io/jpvaneerde/jplay:latest` and `:sha-<commit>` (see
`.github/workflows/build.yml`). The Argo CD app `jplay` runs the image with `imagePullPolicy: Always`. Roll out
a new `latest` with:

```sh
kubectl -n jplay rollout restart deployment/jplay
```

You can also pin `sha-…` tags in `apps/jplay/kustomization.yaml`.
