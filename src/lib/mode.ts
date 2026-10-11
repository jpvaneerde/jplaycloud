// go.jplay.cloud is the QR-code version: the same game, but each song is shown as a QR code
// that a phone scans (scanner.jplay.cloud) and plays in its own Spotify app.
// Locally: http://go.localhost:5173

export const QR_MODE = /^go\./i.test(location.hostname);

/** The other version of JPlay, for links between the two. */
export function otherUrl(path = '/') {
  const port = location.port ? `:${location.port}` : '';
  if (QR_MODE) {
    const host = location.hostname.replace(/^go\./i, '');
    return `${location.protocol}//${host === 'localhost' ? '127.0.0.1' : host}${port}${path}`;
  }
  const host = location.hostname === '127.0.0.1' ? 'localhost' : location.hostname;
  return `${location.protocol}//go.${host}${port}${path}`;
}

/** What a turn's QR code holds: the card link, or a plain Spotify link for songs without a card yet. */
export function qrText(song: { uri: string; qr?: string }) {
  return song.qr ?? `https://open.spotify.com/track/${song.uri.split(':').pop()}`;
}
