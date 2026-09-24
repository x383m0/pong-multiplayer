# 1v1 Tetris (peer-to-peer, no backend)

Two people, two separate boards, connected browser-to-browser over WebRTC.
Clear multiple lines at once to send garbage lines to your opponent's board.
First person to top out loses.

## Dependencies to install

**None.** Same as before — no `npm install`, no server. The only external
piece is the PeerJS library loaded from a CDN in `index.html`:

```html
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
```

`index.html`, `style.css`, and `game.js` are the whole project.

## How the networking works (and why it's different from the Pong version)

Tetris doesn't have one shared object like Pong's ball — each player has
their **own independent board**. So instead of one computer being the
"authority" that computes everything, **each computer simulates its own
board locally**, for zero-lag controls. The only things sent over the
connection are:

- A snapshot of your board (so your friend's screen can show a small preview
  of what you're doing)
- A "garbage" message when you clear 2+ lines at once, which adds junk rows
  to your opponent's board
- A "game over" message when you top out, so your opponent knows they won

## Uploading to your existing GitHub repo

Since git isn't installed on the school computer, use the same browser
upload method as before:

1. Go to your repo on github.com.
2. Delete the old `index.html`, `style.css`, and `game.js` (click each file →
   trash-can icon → commit the deletion), or just re-upload — GitHub will
   ask if you want to replace files with the same name.
3. Click **Add file → Upload files**, drag in the new `index.html`,
   `style.css`, `game.js`, and this `README.md`.
4. Commit the changes. GitHub Pages will automatically redeploy your live
   URL with the new game — no need to touch the Pages settings again.

## Controls

- **← / →** — move left/right
- **↑** — rotate
- **↓** — soft drop (hold for faster descent)
- **Space** — hard drop (slam the piece down instantly)

## Garbage rules

| Lines cleared at once | Garbage sent to opponent |
|---|---|
| 1 | 0 |
| 2 | 1 |
| 3 | 2 |
| 4 (Tetris) | 4 |

## Known limitations

- No restart button — refresh the page for a rematch.
- No wall-kick system as sophisticated as official Tetris (SRS); rotation
  uses simple left/right nudges if the default rotation doesn't fit.
- Same WebRTC caveat as before: strict firewalls without a TURN relay can
  occasionally block the connection, though same-network wired connections
  (like a school LAN) tend to work fine.
