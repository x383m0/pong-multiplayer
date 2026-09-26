# Wings Arena — multiplayer sky battle (up to 8 players)

A free-for-all F-16 dogfight in the browser, rendered side-on (think
wings.io) rather than from above — planes bank, dive and loop as they turn to
face your cursor. One person hosts, up to seven friends join with a code.
Fly around an open arena above rolling hills, collect coins for score, gun
down or missile opponents, respawn, repeat. No server, no build step, no
dependencies to install — same approach as the Tetris project this was built
from.

## Dependencies to install

None. Just `index.html`, `style.css`, `game.js`, loading PeerJS from a CDN:

```html
<script src="https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js"></script>
```

## How the networking works (same hub topology as before)

With more than two players, everyone connecting directly to everyone else
gets complicated fast. So everyone connects only to the host, and the host
relays messages — if Player 2 shoots at Player 3, that shot travels
Player 2 → Host → Player 3. Joiners only ever need the host's code, never
each other's.

Split of responsibilities:

- **Each client is authoritative over its own plane.** You decide your own
  position, heading, and — crucially — whether an incoming bullet hit *you*.
  This keeps movement perfectly smooth locally (no waiting on the network)
  and matches how the Tetris version had each player own their own board.
- **The host is authoritative over coins and kill credit.** The host spawns
  coins, decides who gets credit when a `collect` message arrives first, and
  tallies kills/deaths when a `died` message arrives — so score can't
  double-count even if two players grab the same coin in the same instant.
- **Position updates broadcast ~15 times/sec** (every 66ms), same cadence as
  the Tetris board sync. Each client still *renders* at a full 60fps, though:
  incoming updates are stored as a target position, and every other player's
  plane glides toward that target each frame instead of snapping to it. Without
  this, remote planes visibly teleport 15 times a second, which reads as
  choppy, low-framerate motion even though your own plane is smooth.
- **Shots are relayed as fire-and-forget events** — the shooter simulates the
  bullet locally and tells everyone else "a bullet was fired from here, going
  this way," and each client checks that bullet against their own plane only.
- **Missiles and flares work the same fire-and-forget way**, with one twist:
  a missile also carries a `targetId` (whoever it locked onto at launch).
  Every client simulates that missile's homing turn independently, steering
  it toward wherever it currently believes the target is (using the same
  synced/interpolated position everyone already has). Only the locked target
  — or anyone, once a flare knocks the lock off — checks it for a hit against
  their own plane, exactly like bullets.

## Hosting on GitHub Pages

1. Create a new repo (or reuse the Tetris one) and upload `index.html`,
   `style.css`, and `game.js` to the root — drag-and-drop via
   **Add file → Upload files**, then commit.
2. In the repo, go to **Settings → Pages**, set the source to your default
   branch (usually `main`) and the root folder, and save.
3. GitHub gives you a URL like `https://yourname.github.io/your-repo/`.
   Share that link — anyone who opens it can host or join a match.
4. Future edits: just re-upload the changed files and commit. Pages
   redeploys automatically.

## How to play with up to 8 people

1. Everyone enters a callsign (optional — defaults to "Player").
2. One person clicks **Host Game** and shares the code shown.
3. Up to seven friends each click **Join Game** and paste in that code.
4. The host sees a lobby list of who's connected and clicks **Start Game**
   whenever ready (doesn't need all 8).
5. Everyone spawns into the same open sky arena. Coins are worth 10 points;
   shooting someone down is worth 50 and adds to your kill count.
6. Get shot to 0 HP and you respawn after ~2 seconds with brief
   invulnerability (your plane flickers). There's no match end — it's an
   open-ended arena, so play as long as you like.

## Controls

- **Mouse movement** — steer. The plane always flies forward and turns to
  face wherever your cursor is (the camera keeps you centered on screen, so
  the turn is computed straight from screen-center → cursor). Turning is
  deliberately sluggish — it's a jet, not a go-kart — and gets noticeably
  harder while boosting, trading agility for speed.
- **↑** or **W** — boost (limited meter, recharges when not in use)
- **Left click** or **Space** — fire the gun, at a very high rate of fire
- **Right-click** or **Q** — fire a homing missile (limited ammo)
- **F** — pop a flare to break an incoming missile's lock

### Gun heat

The gun fires fast (about 90ms between shots), but holding it down builds
heat. Max out the heat bar and the gun locks up until it cools back down —
so short controlled bursts beat holding the trigger. Heat drains on its own
whenever you let off fire, and drains faster once you've overheated.

### Missiles & flares

Missiles lock onto the nearest enemy plane roughly in front of you (within
range and a forward cone) the moment you fire, then home in on that target
for the rest of their flight — they out-turn a plane on its own, so outrunning
one by boosting in a straight line or juking alone is hard. You carry 4, and
they regenerate slowly over time.

A flare is the reliable counter: pop one (you carry 3, also slow-regenerating)
and any missile currently locked onto you within range detonates on the flare
right there — a real explosion, gone instantly — instead of hitting you. A
locked missile shows a flashing on-screen warning so you know to react. If a
missile's target dies or disconnects mid-flight, it goes ballistic (keeps
flying straight, no more homing) instead of exploding, since there's nothing
left to decoy it away from.

### Effects

Muzzle flashes on the gun, a smoke puff on missile launch, sparks on bullet
hits, a proper blast on missile hits and flare intercepts, a bigger explosion
when a plane goes down, and a sparkle when you grab a coin. Hit/kill effects
are synced over the network (a small `impact`/`killed` message tells every
other client to remove that projectile and play the explosion at the same
spot and moment), so everyone sees the same thing at roughly the same time,
not just whoever got hit.

Heat and missile/flare ammo, like hit detection below, are tracked and
self-reported client-side, so it's fine for casual play but not hardened
against a modified client.

## Known limitations
- If the host disconnects, the match ends for everyone (the host is the
  relay hub and the coin/score authority). Joiners disconnecting doesn't
  affect anyone else.
- Hit detection trusts the player being shot at to self-report the hit
  (the same trust model the Tetris version used for eliminations). Fine for
  a casual game with friends; not hardened against a modified client.
- Same WebRTC caveat as always: same-network setups connect reliably;
  separate networks with strict firewalls occasionally need a TURN relay,
  which isn't included here.
- No sound effects or mobile touch controls yet — keyboard/mouse only.

## Recent fixes
- Shots fired by anyone other than the host used to be invisible to the host
  and couldn't damage it — the host relayed those shots to other clients but
  never added them to its own local bullet list. It now does (and the same
  fix applies to missiles).
- Respawning never actually happened — the update function returned before
  the code that checks the respawn timer, so that check never ran.
