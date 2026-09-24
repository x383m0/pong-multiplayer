# Online Pong (2-player, peer-to-peer)

A simple Pong game for two people on separate computers, connected directly
browser-to-browser over WebRTC (no backend server needed). One player hosts,
shares a short code, the other joins with it.

## Dependencies to install

**None, locally.** There's no `npm install`, no Node.js server, nothing to
run. The only "dependency" is the PeerJS library, loaded straight from a CDN
in `index.html`:

```html
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
```

That's it — `index.html`, `style.css`, and `game.js` are the whole project.

Optional, for local testing in VS Code:
- The **Live Server** extension, so you can right-click `index.html` →
  "Open with Live Server" and test in a real browser tab (double-clicking
  the file directly also works fine here since there's no build step).

## How it works

- PeerJS uses WebRTC to connect the two browsers directly to each other.
  It relies on PeerJS's free public "cloud" signaling server just to help
  the two browsers find each other and negotiate the connection — after
  that, game data (paddle position, ball position, score) flows directly
  between the two players, not through any server of yours.
- The **host** runs the actual game physics (ball movement, collisions,
  scoring) and streams the game state to the other player every frame.
- The **joiner** just sends their paddle's up/down input to the host and
  renders whatever state the host sends back.

## Hosting on GitHub Pages

1. Push these three files (`index.html`, `style.css`, `game.js`) to a GitHub
   repo.
2. In the repo, go to **Settings → Pages**, set the source to your default
   branch (e.g. `main`) and root folder, then save.
3. GitHub will give you a URL like `https://yourusername.github.io/repo-name/`.
4. Send that link to your friend. One of you clicks **Host Game**, copies the
   code shown, sends it (Discord/text/whatever), and the other pastes it into
   **Join Game**.

## Controls

- Arrow Up / Arrow Down, or W / S — moves your paddle.
- Host controls the left paddle, the joiner controls the right paddle.

## Known limitations

- **Strict firewalls/corporate NAT**: WebRTC peer-to-peer connections can
  occasionally fail to establish on networks with strict NAT/firewall rules
  (common on corporate or school Wi-Fi), since this setup has no TURN relay
  server as a fallback. If a connection won't establish, try a different
  network (e.g. home Wi-Fi or mobile hotspot).
- There's no reconnect logic — if the connection drops, refresh the page and
  reconnect.
- This is intentionally simple (no lag compensation/interpolation), so on a
  slow connection the joiner may see slightly choppy ball movement.
