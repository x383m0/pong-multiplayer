# Tetris Online — up to 4 players

One person hosts, up to three friends join with a code. Everyone plays their
own board; clearing 2+ lines at once fires garbage at a random opponent.
Last player standing wins.

## Dependencies to install

Still none. Same as before — `index.html`, `style.css`, `game.js`, loading
PeerJS from a CDN:

```html
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
```

## What changed from the 2-player version

**Networking (hub topology):** with more than 2 players, having everyone
connect directly to everyone else gets complicated fast. Instead, everyone
connects only to the host, and the host relays messages between players —
so if Player 2 attacks Player 3, that message travels Player 2 → Host →
Player 3. This keeps the setup simple: joiners only ever need the host's
code, never each other's.

**Two bugs fixed:**

1. **Hard drop placing multiple pieces per press.** The browser's built-in
   "is this key being held down" signal isn't fully reliable across
   browsers, so a single space-bar press was occasionally being read as
   several. Movement keys now track their own held/not-held state manually
   instead of trusting the browser, so each press fires exactly once.
2. **Inconsistent left/right movement (1, 2, or 5 steps).** This was almost
   certainly a "stuck key" problem: if the browser tab loses focus for even
   a moment while a key is held (switching windows, alt-tabbing to grab the
   host's code, etc.), the browser can miss the "key released" event —
   so the game kept thinking the key was still held down. Now, the instant
   the window loses focus, all movement is force-reset, so a stray tab
   switch can't leave a key "stuck." A lag spike is also now capped so it
   can't be "caught up" in one big multi-step jump.

## Hosting on GitHub Pages

Same as before: replace `index.html`, `style.css`, and `game.js` in your
existing repo (Add file → Upload files, drag these in, commit). GitHub Pages
redeploys automatically — no need to touch the Pages settings again.

## How to play with up to 4 people

1. One person clicks **Host Game** and shares the code shown.
2. Up to three friends each click **Join Game** and paste in that code.
3. The host sees a lobby list of who's connected and can click
   **Start Game** any time there are at least 2 players total (you don't
   need all 4 to start).
4. Everyone plays their own board. Opponent boards appear as small previews
   on the side; a greyed-out preview means that player has been eliminated.
5. Clear 2+ lines at once to send garbage to a random still-alive opponent.
6. Last person standing wins — everyone sees the result.

## Controls

- **← / →** — move left/right
- **↑** — rotate
- **↓** — soft drop (hold for faster descent)
- **Space** — hard drop

## Known limitations

- No restart button — refresh the page for a rematch.
- If the host disconnects, the match ends for everyone (the host is the
  relay hub). Joiners disconnecting doesn't affect anyone else.
- Same WebRTC caveat as always: a same-network/wired setup (like a school
  LAN) tends to connect reliably; separate networks with strict firewalls
  occasionally need a TURN relay, which isn't included here.
