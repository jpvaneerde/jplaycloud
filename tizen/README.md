# JPlay on a Samsung TV

A small Tizen app that opens **go.jplay.cloud in TV mode**: the QR-code version of the game, laid out for the sofa
and played with the remote. Phones scan each song's QR code with the scanner (scanner.jplay.cloud) and play it in
Spotify, so nothing plays on the TV.

The app opens the site directly (`content src` in `config.xml`): the game comes from the server, so updating JPlay
never needs a reinstall. Reinstall only when something in this folder changes.

## On the TV

- **Sign in:** the TV shows a QR code and a 6-letter code. Scan it with your phone (or open go.jplay.cloud/tv and
  type the code), log in on the phone if it asks, and tap **Sign in the TV**. The TV stays signed in (30 days,
  extended whenever it's used). **Log out** on the setup screen signs it out.
- **Remote:** the arrows move between buttons, OK presses them, Back closes what's open (options, played songs),
  then goes back a page; on the start screen it closes the app.
- **Typing** (player names) uses the TV's on-screen keyboard: press OK on a name box.
- The same TV mode works in any browser: open `https://go.jplay.cloud/?tv=1` (remembered on that browser;
  `?tv=0` turns it off). Samsung's own browser turns it on by itself.

## Build and install

You need Tizen Studio (or the Tizen extension for VS Code, which uses it) with the **TV extensions** and the
**Samsung Certificate Extension**, and the TV in developer mode with your PC's IP address entered.

1. **Connect the TV** in Device Manager (TV's IP address, port 26101), or from a terminal:
   ```
   sdb connect 192.168.1.50
   ```
2. **Certificate:** in Certificate Manager, create a **Samsung** certificate profile (log in with your Samsung
   account; choose TV). While the TV is connected, its DUID is added to the distributor certificate. Without that,
   the TV refuses the app.
3. **Build and install.** In VS Code, open this `tizen` folder as a Tizen project and use the extension's
   build/run command. Or with the Tizen CLI (`tizen-studio/tools/ide/bin`), from the repo root:
   ```
   tizen package -t wgt -s <your certificate profile> -- tizen
   tizen install -n JPlay.wgt -t <device name from 'sdb devices'> -- tizen
   tizen run -p JPlayTVapp.JPlay -t <device name>
   ```
4. JPlay now sits with your apps on the TV. Move it to the home row like any other app.

## Notes

- **Firmware updates** sometimes switch developer mode off. The installed app keeps working; you only need developer
  mode again to install a new version.
- **Testing another server:** change `content src` in `config.xml` and add its host to `tizen:allow-navigation`.
- **Something wrong on the TV?** Use the extension's **Debug Project**: it opens Chrome's inspector on the app, with
  the console and network requests.
- **Older TVs:** the game needs a Samsung TV from 2022 or later (Tizen 6.5). Some older models may work.
