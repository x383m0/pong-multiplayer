// ================= Constants =================
const WORLD_W = 3600, WORLD_H = 1700;
const GROUND_Y = WORLD_H - 70;    // top of the water (side-view floor)
const MAX_PLAYERS = 8;

const PLANE_SPEED = 285;          // px/s forward, constant auto-flight
const BOOST_MULT = 1.95;
const BOOST_MAX = 100, BOOST_DRAIN = 55, BOOST_REGEN = 22; // per second
const TURN_RATE = 2.1;            // rad/s the plane turns to face the mouse cursor — deliberately sluggish
const BOOST_TURN_MULT = 0.55;     // turning gets noticeably harder while boosting (speed vs. agility trade-off)

const BULLET_SPEED = 1320, BULLET_LIFE = 620, FIRE_COOLDOWN = 55, BULLET_DAMAGE = 7;
const HIT_RADIUS = 32, BULLET_RADIUS = 3;

// Gun heat: ultra-fast RPM, but holding fire builds heat until it locks out.
const HEAT_MAX = 100, HEAT_PER_SHOT = 8, HEAT_DECAY = 24, HEAT_DECAY_OVERHEAT = 40;
const OVERHEAT_RESET_FRAC = 0.1;  // must cool back down to 10% heat before firing again

// Homing missiles: limited ammo, regenerates slowly, turns faster than a
// plane can (so out-turning one alone is hard) but can be decoyed by a flare.
const MISSILE_SPEED = 500, MISSILE_TURN_RATE = 4.6, MISSILE_LIFE = 4200, MISSILE_DAMAGE = 55;
const MISSILE_HIT_RADIUS = 36, MISSILE_LOCK_RANGE = 800, MISSILE_LOCK_CONE = Math.PI / 3;
const MISSILE_MAX = 4, MISSILE_REGEN_MS = 5000, MISSILE_COOLDOWN = 900;

// Flares: a limited-charge countermeasure that breaks a missile's lock if
// it's fired within FLARE_BREAK_RADIUS of the missile at the moment of use.
const FLARE_MAX = 3, FLARE_REGEN_MS = 7000, FLARE_MIN_INTERVAL = 400;
const FLARE_BREAK_RADIUS = 260, FLARE_ACTIVE_MS = 900;

const REMOTE_SMOOTH = 12;         // how fast other players' rendered planes catch up to network updates

// Visual-only effects: short-lived radial bursts drawn at an (x,y) for a
// fixed lifetime, used for gun/missile impacts, launches, kills, and pickups.
const FX = {
  spark:  { life: 220, r: 16, colors: ['rgba(255,255,255,0.98)',  'rgba(255,150,60,0.9)', 'rgba(255,55,25,0)'] },
  blast:  { life: 620, r: 88, colors: ['rgba(255,255,255,1)', 'rgba(255,150,35,0.95)', 'rgba(255,35,10,0)'] },
  crash:  { life: 850, r: 120, colors: ['rgba(255,255,255,1)', 'rgba(255,105,25,0.95)', 'rgba(40,10,5,0)'] },
  muzzle: { life: 115, r: 18, colors: ['rgba(255,255,230,1)', 'rgba(255,190,75,0.82)', 'rgba(255,70,20,0)'] },
  launch: { life: 420, r: 34, colors: ['rgba(255,255,255,0.95)', 'rgba(110,220,255,0.7)', 'rgba(25,95,150,0)'] },
  shock:  { life: 360, r: 72, colors: ['rgba(255,225,140,0.9)', 'rgba(255,90,30,0.5)', 'rgba(255,30,10,0)'] },
  coin:   { life: 320, r: 14, colors: ['rgba(255,250,210,0.95)', 'rgba(255,209,102,0.85)','rgba(255,190,60,0)'] }
};

const MAX_HEALTH = 100, RESPAWN_DELAY = 2200, INVULN_TIME = 1500;
const COIN_CAP = 16, COIN_VALUE = 10, COIN_PICKUP_RADIUS = 30, COIN_SPAWN_EVERY = 1800;
const KILL_SCORE = 50;

const COLORS = ['#ff6b6b', '#4dd0e1', '#ffd166', '#9d7bff', '#6fe08a', '#ff9f43', '#5ea8ff', '#f472b6'];

// ================= Shared state =================
let peer = null, isHost = false, myId = null, myName = 'Player';
let connections = {};             // host: {id -> DataConnection}; client: {host -> DataConnection}
let players = {};                 // id -> {id,name,connected,alive,x,y,angle,health,score,kills,color}
let coins = [];                   // {id,x,y}
let bullets = [];                 // {id,ownerId,x,y,angle,born}
let missiles = [];                // {id,ownerId,targetId,x,y,angle,born,trail}
let flares = [];                  // {x,y,born} — cosmetic + decoy trigger
let explosions = [];              // {x,y,born,kind} — see FX above
let clouds = [];
let stars = [];
let started = false, coinCounter = 0, nextBulletId = 0, nextMissileId = 0;

let myState = null;               // local authoritative plane state
let killFeedEl, lbListEl, scoreValEl, killsValEl, hpFillEl, boostFillEl, heatFillEl;
let missileCountEl, flareCountEl, lockWarningEl;
let respawnOverlay, respawnMsgEl, respawnTimerEl;
let statusEl, lobbyList, startBtn, chooseRole, lobby, menu, gameArea, waitHint;
let skyCanvas, skyCtx, miniCanvas, miniCtx;
let lastSpawnTick = 0;
let audioCtx = null, masterGain = null;
let audioBank = {}, engineAudio = null, audioAssetsStarted = false;
let screenShake = 0, recoilKick = 0, lastIncomingLock = false, wasBoosting = false;

const AUDIO_ASSETS = {
  cannon: 'audio/a10-cannon.ogg',
  engine: 'audio/a10-engine.ogg',
  flyby: 'audio/jet-flyby.ogg',
  missile: 'audio/missile-launch.ogg',
  explosion: 'audio/airplane-explosion.ogg',
  impact: 'audio/heavy-impact.ogg',
  flare: 'audio/flare.ogg',
  lock: 'audio/lock-alarm.ogg',
  boost: 'audio/boost-air.ogg'
};

// ================= World helpers =================
function rand(min, max) { return min + Math.random() * (max - min); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function dist(x1, y1, x2, y2) { return Math.hypot(x1 - x2, y1 - y2); }
function colorFor(id) { return COLORS[id % COLORS.length]; }
// Shortest signed angular distance from `from` to `to`, in (-PI, PI].
function angleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Small procedural sound rig: it starts only after a user gesture and keeps
// the game self-contained. The cannon uses layered low oscillators + clipped
// noise to suggest a fast, heavy rotary cannon without shipping an audio file.
function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain(); masterGain.gain.value = 0.24; masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  if (!audioAssetsStarted) {
    audioAssetsStarted = true;
    Object.entries(AUDIO_ASSETS).forEach(([name, src]) => {
      const a = new Audio(src); a.preload = 'auto'; audioBank[name] = a;
    });
  }
}
function playAsset(name, volume = .65, rate = 1) {
  const source = audioBank[name]; if (!source) return false;
  const a = source.cloneNode(); a.volume = clamp(volume, 0, 1); a.playbackRate = rate;
  a.play().catch(() => {}); return true;
}
function startEngineAudio() {
  if (engineAudio || !audioBank.engine) return;
  engineAudio = audioBank.engine.cloneNode(); engineAudio.loop = true; engineAudio.volume = .16;
  engineAudio.play().catch(() => {});
}
function updateEngineAudio() {
  if (!engineAudio) return;
  const boost = keysHeld.boost && myState && myState.boost > 0;
  engineAudio.volume = boost ? .24 : .16;
  engineAudio.playbackRate = boost ? 1.08 : .96;
}
function tone(freq, duration, volume, type = 'sine', slide = 0) {
  if (!audioCtx || !masterGain) return;
  const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + duration);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(volume, t + .008); g.gain.exponentialRampToValueAtTime(.0001, t + duration);
  o.connect(g); g.connect(masterGain); o.start(t); o.stop(t + duration + .02);
}
function noiseBurst(duration, volume, filterType = 'bandpass', frequency = 900) {
  if (!audioCtx || !masterGain) return;
  const length = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
  const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate), data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** .35;
  const source = audioCtx.createBufferSource(), filter = audioCtx.createBiquadFilter(), g = audioCtx.createGain();
  source.buffer = buffer; filter.type = filterType; filter.frequency.value = frequency; filter.Q.value = .8;
  g.gain.setValueAtTime(volume, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + duration);
  source.connect(filter); filter.connect(g); g.connect(masterGain); source.start();
}
function playCannonSound() { if (!playAsset('cannon', .82, 1.12)) { noiseBurst(.055, .34, 'bandpass', 1100); tone(82, .075, .24, 'sawtooth', -32); } }
function playMissileLaunchSound() { if (!playAsset('missile', .9, 1.05)) { noiseBurst(.34, .2, 'lowpass', 520); tone(92, .38, .22, 'sawtooth', 240); } }
function playExplosionSound(kind) {
  if (kind === 'blast' || kind === 'crash' || kind === 'shock') { if (!playAsset('explosion', kind === 'crash' ? .95 : .78, kind === 'crash' ? .88 : 1)) { noiseBurst(kind === 'crash' ? .5 : .32, .42, 'lowpass', 240); tone(kind === 'crash' ? 42 : 58, .52, .36, 'sine', -34); } }
  else if (kind === 'spark') playAsset('impact', .48, 1.08);
}
function playLockSound() { if (!playAsset('lock', .48, 1.15)) tone(880, .08, .09, 'square', -220); }

function spawnExplosion(x, y, kind) {
  explosions.push({ x, y, born: performance.now(), kind });
  playExplosionSound(kind);
  if (kind === 'blast' || kind === 'crash' || kind === 'shock') screenShake = Math.max(screenShake, kind === 'crash' ? 18 : 11);
}
function pruneExplosions(now) {
  for (let i = explosions.length - 1; i >= 0; i--) {
    if (now - explosions[i].born > FX[explosions[i].kind].life) explosions.splice(i, 1);
  }
}
// Used when another client reports a hit on a bullet/missile we're also
// tracking locally, so our copy disappears (with an effect) at the same time.
function removeProjectileLocal(kind, id) {
  const arr = kind === 'missile' ? missiles : bullets;
  const idx = arr.findIndex(p => p.id === id);
  if (idx !== -1) arr.splice(idx, 1);
}

function buildClouds() {
  clouds = [];
  stars = [];
  for (let i = 0; i < 90; i++) {
    clouds.push({
      x: rand(0, WORLD_W), y: rand(0, GROUND_Y - 40),
      r: rand(30, 90), a: rand(0.08, 0.22)
    });
  }
  for (let i = 0; i < 180; i++) stars.push({ x: rand(0, WORLD_W), y: rand(0, GROUND_Y - 80), r: rand(.4, 1.5), a: rand(.15, .55) });
}

function randomSpawnPoint() {
  return { x: rand(200, WORLD_W - 200), y: rand(120, GROUND_Y - 160) };
}

function freshPlayerState(id, name) {
  const p = randomSpawnPoint();
  const angle = rand(0, Math.PI * 2);
  return {
    id, name, connected: true, alive: true,
    x: p.x, y: p.y, angle,
    tx: p.x, ty: p.y, tangle: angle, synced: false, // network target for smoothing remote planes
    health: MAX_HEALTH, score: 0, kills: 0, deaths: 0,
    color: colorFor(id), invulnUntil: performance.now() + INVULN_TIME
  };
}

// ================= Local plane simulation =================
function createLocalState() {
  const base = freshPlayerState(myId, myName);
  return Object.assign(base, {
    boost: BOOST_MAX, heat: 0, overheated: false, fireTimer: 0, respawnAt: 0,
    missiles: MISSILE_MAX, missileCooldown: 0, missileRegenTimer: 0,
    flares: FLARE_MAX, flareCooldown: 0, flareRegenTimer: 0
  });
}

function respawnLocal() {
  const p = randomSpawnPoint();
  myState.x = p.x; myState.y = p.y;
  myState.angle = rand(0, Math.PI * 2);
  myState.health = MAX_HEALTH;
  myState.heat = 0;
  myState.overheated = false;
  myState.missiles = MISSILE_MAX; myState.missileCooldown = 0; myState.missileRegenTimer = 0;
  myState.flares = FLARE_MAX; myState.flareCooldown = 0; myState.flareRegenTimer = 0;
  myState.alive = true;
  myState.invulnUntil = performance.now() + INVULN_TIME;
  respawnOverlay.style.display = 'none';
}

function updateLocalPlane(dtSec, keys) {
  if (!myState.alive) {
    // Was returning before this check ever ran, so nobody ever respawned.
    if (myState.respawnAt && performance.now() >= myState.respawnAt) {
      myState.respawnAt = 0;
      respawnLocal();
    }
    return;
  }

  // Steer toward the mouse cursor. The camera always keeps the player
  // centered on screen, so "screen center -> cursor" gives the aim angle.
  // Boosting trades agility for speed, same as a real jet's wider turn radius.
  const boosting = keys.boost && myState.boost > 0;
  const targetAngle = Math.atan2(mouseY - window.innerHeight / 2, mouseX - window.innerWidth / 2);
  const turnStep = TURN_RATE * (boosting ? BOOST_TURN_MULT : 1) * dtSec;
  const diff = angleDiff(myState.angle, targetAngle);
  myState.angle += Math.abs(diff) < turnStep ? diff : Math.sign(diff) * turnStep;

  if (boosting) myState.boost = Math.max(0, myState.boost - BOOST_DRAIN * dtSec);
  else myState.boost = Math.min(BOOST_MAX, myState.boost + BOOST_REGEN * dtSec);

  const speed = PLANE_SPEED * (boosting ? BOOST_MULT : 1);
  myState.x += Math.cos(myState.angle) * speed * dtSec;
  myState.y += Math.sin(myState.angle) * speed * dtSec;
  myState.x = clamp(myState.x, 30, WORLD_W - 30);
  myState.y = clamp(myState.y, 30, GROUND_Y - 40);

  // Weapon heat: cools passively when you let off the trigger; maxing it
  // out locks the gun until it drops back down, so you can't just hold fire.
  if (myState.overheated) {
    myState.heat = Math.max(0, myState.heat - HEAT_DECAY_OVERHEAT * dtSec);
    if (myState.heat <= HEAT_MAX * OVERHEAT_RESET_FRAC) myState.overheated = false;
  } else if (!keys.shoot) {
    myState.heat = Math.max(0, myState.heat - HEAT_DECAY * dtSec);
  }

  myState.fireTimer = Math.max(0, myState.fireTimer - dtSec * 1000);
  if (keys.shoot && !myState.overheated && myState.fireTimer <= 0) {
    myState.fireTimer = FIRE_COOLDOWN;
    fireBullet();
    myState.heat = Math.min(HEAT_MAX, myState.heat + HEAT_PER_SHOT);
    if (myState.heat >= HEAT_MAX) myState.overheated = true;
  }

  // Missile & flare cooldowns and slow passive regen.
  myState.missileCooldown = Math.max(0, myState.missileCooldown - dtSec * 1000);
  myState.missileRegenTimer += dtSec * 1000;
  if (myState.missiles < MISSILE_MAX && myState.missileRegenTimer >= MISSILE_REGEN_MS) {
    myState.missileRegenTimer = 0;
    myState.missiles++;
  }
  myState.flareCooldown = Math.max(0, myState.flareCooldown - dtSec * 1000);
  myState.flareRegenTimer += dtSec * 1000;
  if (myState.flares < FLARE_MAX && myState.flareRegenTimer >= FLARE_REGEN_MS) {
    myState.flareRegenTimer = 0;
    myState.flares++;
  }

  // coin pickup (optimistic local removal + tell host)
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    if (dist(myState.x, myState.y, c.x, c.y) < COIN_PICKUP_RADIUS) {
      coins.splice(i, 1);
      sendEvent({ type: 'collect', id: c.id });
    }
  }

  // incoming bullet damage (only bullets NOT owned by me)
  const now = performance.now();
  const invuln = now < myState.invulnUntil;
  if (!invuln) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      if (b.ownerId === myId) continue;
      if (dist(myState.x, myState.y, b.x, b.y) < HIT_RADIUS) {
        bullets.splice(i, 1);
        spawnExplosion(b.x, b.y, 'spark');
        sendEvent({ type: 'impact', kind: 'bullet', id: b.id, x: b.x, y: b.y });
        myState.health -= BULLET_DAMAGE;
        if (myState.health <= 0) {
          myState.health = 0;
          myState.alive = false;
          myState.deaths = (myState.deaths || 0) + 1;
          respawnMsgEl.textContent = 'Shot down!';
          respawnOverlay.style.display = 'flex';
          myState.respawnAt = now + RESPAWN_DELAY;
          sendEvent({ type: 'died', by: b.ownerId });
        }
        break;
      }
    }
  }

  // incoming missile damage: only the locked target checks it, or anyone if
  // it's gone dumb-fire (no target — e.g. its own target died mid-flight)
  if (!invuln && myState.alive) {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      if (m.ownerId === myId) continue;
      if (m.targetId != null && m.targetId !== myId) continue;
      if (dist(myState.x, myState.y, m.x, m.y) < MISSILE_HIT_RADIUS) {
        missiles.splice(i, 1);
        spawnExplosion(m.x, m.y, 'blast');
        sendEvent({ type: 'impact', kind: 'missile', id: m.id, x: m.x, y: m.y });
        myState.health -= MISSILE_DAMAGE;
        if (myState.health <= 0) {
          myState.health = 0;
          myState.alive = false;
          myState.deaths = (myState.deaths || 0) + 1;
          respawnMsgEl.textContent = 'Shot down!';
          respawnOverlay.style.display = 'flex';
          myState.respawnAt = now + RESPAWN_DELAY;
          sendEvent({ type: 'died', by: m.ownerId });
        }
        break;
      }
    }
  }
}

function fireBullet() {
  unlockAudio();
  const nose = 38;
  const b = {
    id: myId + '-' + (nextBulletId++), ownerId: myId,
    x: myState.x + Math.cos(myState.angle) * nose,
    y: myState.y + Math.sin(myState.angle) * nose,
    prevX: myState.x, prevY: myState.y, angle: myState.angle, born: performance.now()
  };
  bullets.push(b);
  spawnExplosion(b.x, b.y, 'muzzle');
  playCannonSound(); recoilKick = Math.min(10, recoilKick + 3.2);
  sendEvent({ type: 'shoot', id: b.id, x: b.x, y: b.y, angle: b.angle });
}

function updateBullets(dtSec) {
  const now = performance.now();
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (now - b.born > BULLET_LIFE) { spawnExplosion(b.x, b.y, 'muzzle'); bullets.splice(i, 1); continue; }
    b.prevX = b.x; b.prevY = b.y;
    b.x += Math.cos(b.angle) * BULLET_SPEED * dtSec;
    b.y += Math.sin(b.angle) * BULLET_SPEED * dtSec;
  }
}

// ================= Missiles & flares =================
function findMissileLockTarget() {
  let bestId = null, bestDist = MISSILE_LOCK_RANGE;
  Object.values(players).forEach(p => {
    if (p.id === myId || p.connected === false || p.alive === false) return;
    const dx = p.x - myState.x, dy = p.y - myState.y;
    const d = Math.hypot(dx, dy);
    if (d > bestDist) return;
    const angToTarget = Math.atan2(dy, dx);
    if (Math.abs(angleDiff(myState.angle, angToTarget)) > MISSILE_LOCK_CONE) return;
    bestDist = d; bestId = p.id;
  });
  return bestId;
}

function tryFireMissile() {
  if (!myState || !myState.alive || myState.missileCooldown > 0 || myState.missiles <= 0) return;
  unlockAudio();
  myState.missileCooldown = MISSILE_COOLDOWN;
  myState.missiles--;

  const targetId = findMissileLockTarget();
  const nose = 22;
  const m = {
    id: myId + '-m' + (nextMissileId++), ownerId: myId, targetId,
    x: myState.x + Math.cos(myState.angle) * nose,
    y: myState.y + Math.sin(myState.angle) * nose,
    angle: myState.angle, born: performance.now(), trail: [], exhaust: 1
  };
  missiles.push(m);
  spawnExplosion(m.x, m.y, 'launch');
  playMissileLaunchSound(); screenShake = Math.max(screenShake, 7);
  sendEvent({ type: 'missile', id: m.id, targetId, x: m.x, y: m.y, angle: m.angle });
}

function tryDeployFlare() {
  if (!myState || !myState.alive || myState.flareCooldown > 0 || myState.flares <= 0) return;
  myState.flareCooldown = FLARE_MIN_INTERVAL;
  myState.flares--;
  playAsset('flare', .62, 1.15);

  const f = { x: myState.x, y: myState.y, born: performance.now() };
  flares.push(f);
  resolveFlare(myId, f.x, f.y);
  sendEvent({ type: 'flare', x: f.x, y: f.y });
}

// Detonates any missile (in our own local copy of the world) that's currently
// homing on `fromId` and is close enough to this flare to be fooled by it —
// it explodes on the flare right there rather than flying past it.
function resolveFlare(fromId, fx, fy) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    if (m.targetId === fromId && dist(m.x, m.y, fx, fy) < FLARE_BREAK_RADIUS) {
      spawnExplosion(m.x, m.y, 'shock');
      missiles.splice(i, 1);
    }
  }
}

function updateMissiles(dtSec) {
  const now = performance.now();
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    if (now - m.born > MISSILE_LIFE) {
      // Used to just vanish here with no feedback at all if it never caught
      // its target — now it detonates in place so a miss is at least visible.
      spawnExplosion(m.x, m.y, 'blast');
      missiles.splice(i, 1);
      continue;
    }

    if (m.targetId != null) {
      const target = players[m.targetId];
      if (target && target.alive !== false && target.connected !== false) {
        const desired = Math.atan2(target.y - m.y, target.x - m.x);
        const step = MISSILE_TURN_RATE * dtSec;
        const diff = angleDiff(m.angle, desired);
        m.angle += Math.abs(diff) < step ? diff : Math.sign(diff) * step;
      } else {
        m.targetId = null; // target died or left: missile goes dumb/ballistic
        m.decoyed = true;
      }
    }

    m.trail.push({ x: m.x, y: m.y });
    if (m.trail.length > 20) m.trail.shift();

    m.x += Math.cos(m.angle) * MISSILE_SPEED * dtSec;
    m.y += Math.sin(m.angle) * MISSILE_SPEED * dtSec;
  }
}

function pruneFlares(now) {
  for (let i = flares.length - 1; i >= 0; i--) {
    if (now - flares[i].born > FLARE_ACTIVE_MS) flares.splice(i, 1);
  }
}

// ================= Networking: host side =================
function startHost() {
  unlockAudio();
  isHost = true; myId = 0;
  players[0] = freshPlayerState(0, myName);
  peer = new Peer();
  peer.on('open', id => {
    statusEl.textContent = 'Share this code: ' + id;
    chooseRole.style.display = 'none'; lobby.style.display = 'flex';
    startBtn.style.display = 'inline-block'; waitHint.style.display = 'none';
    renderLobby();
  });
  peer.on('connection', c => {
    const id = nextFreeId();
    if (id === null) { c.on('open', () => c.send({ type: 'full' })); return; }
    connections[id] = c;
    players[id] = freshPlayerState(id, 'Player ' + (id + 1));
    players[id].connected = true;
    c.on('open', () => {
      c.send({ type: 'welcome', id });
      c.send({ type: 'coins', list: coins });
      broadcastRoster();
    });
    c.on('data', data => handleHostReceive(id, data));
    c.on('close', () => { if (players[id]) players[id].connected = false; broadcastRoster(); });
  });
  startBtn.onclick = () => {
    if (started) return;
    started = true; buildClouds(); spawnInitialCoins();
    broadcast({ type: 'start' });
    broadcast({ type: 'coins', list: coins });
    beginLocalGame();
  };
}

function nextFreeId() {
  for (let i = 1; i < MAX_PLAYERS; i++) if (!players[i] || players[i].connected === false) return i;
  return null;
}

function broadcast(msg) {
  Object.values(connections).forEach(c => { if (c.open) c.send(msg); });
}

function broadcastRoster() {
  renderLobby(); renderLeaderboard();
  broadcast({
    type: 'roster',
    roster: Object.values(players).map(p => ({
      id: p.id, name: p.name, connected: p.connected, alive: p.alive,
      score: p.score, kills: p.kills, deaths: p.deaths, color: p.color
    }))
  });
}

function handleHostReceive(fromId, data) {
  if (data.type === 'state') handleState(fromId, data);
  else if (data.type === 'shoot') handleShoot(fromId, data);
  else if (data.type === 'missile') handleMissile(fromId, data);
  else if (data.type === 'flare') handleFlare(fromId, data);
  else if (data.type === 'impact') handleImpact(fromId, data);
  else if (data.type === 'collect') handleCollect(fromId, data.id);
  else if (data.type === 'died') handleDied(fromId, data.by);
  else if (data.type === 'name') { if (players[fromId]) { players[fromId].name = data.name; broadcastRoster(); } }
}

// Position/angle updates only arrive ~15 times/sec over the network. Instead
// of snapping the remote plane straight to each update (which looks choppy,
// like the game is running at 15fps), we store the update as a target and
// glide the rendered plane toward it every frame in interpolateRemotePlayers().
function applyRemoteState(p, data) {
  if (!p.synced) {
    // First update we've ever gotten for this player: snap immediately so
    // it doesn't visibly slide in from its placeholder spawn point.
    p.x = data.x; p.y = data.y; p.angle = data.angle;
    p.synced = true;
  }
  p.tx = data.x; p.ty = data.y; p.tangle = data.angle;
  p.health = data.health; p.alive = data.alive;
}

function handleState(fromId, data) {
  const p = players[fromId];
  if (p) applyRemoteState(p, data);
  Object.entries(connections).forEach(([id, c]) => {
    if (Number(id) !== fromId && c.open) c.send({ type: 'state', from: fromId, x: data.x, y: data.y, angle: data.angle, health: data.health, alive: data.alive });
  });
}

function handleShoot(fromId, data) {
  // The host is a player too, but this only runs on the host machine. When the
  // shot comes from a connected client, the host's own bullets array never
  // got it before (fireBullet() only pushes locally for whoever fired), so
  // the host neither rendered it nor could take damage from it. Skip the push
  // when the host is the shooter (fromId === myId) since fireBullet() already
  // added it there.
  if (fromId !== myId) {
    bullets.push({ id: data.id, ownerId: fromId, x: data.x, y: data.y, prevX: data.x, prevY: data.y, angle: data.angle, born: performance.now() });
    spawnExplosion(data.x, data.y, 'muzzle');
  }
  Object.entries(connections).forEach(([id, c]) => {
    if (Number(id) !== fromId && c.open) c.send({ type: 'shoot', from: fromId, id: data.id, x: data.x, y: data.y, angle: data.angle });
  });
}

function handleMissile(fromId, data) {
  if (fromId !== myId) {
    missiles.push({ id: data.id, ownerId: fromId, targetId: data.targetId, x: data.x, y: data.y, angle: data.angle, born: performance.now(), trail: [] });
    spawnExplosion(data.x, data.y, 'launch');
  }
  Object.entries(connections).forEach(([id, c]) => {
    if (Number(id) !== fromId && c.open) c.send({ type: 'missile', from: fromId, id: data.id, targetId: data.targetId, x: data.x, y: data.y, angle: data.angle });
  });
}

function handleFlare(fromId, data) {
  if (fromId !== myId) {
    flares.push({ x: data.x, y: data.y, born: performance.now() });
    resolveFlare(fromId, data.x, data.y);
  }
  Object.entries(connections).forEach(([id, c]) => {
    if (Number(id) !== fromId && c.open) c.send({ type: 'flare', from: fromId, x: data.x, y: data.y });
  });
}

// A bullet or missile just hit whoever it was aimed at (data.x/y is where).
// The victim's client already removed its own copy and sent this so every
// other client's copy of that same projectile disappears with an explosion
// at the same moment, instead of lingering until it times out on its own.
function handleImpact(fromId, data) {
  if (fromId !== myId) {
    removeProjectileLocal(data.kind, data.id);
    spawnExplosion(data.x, data.y, data.kind === 'missile' ? 'blast' : 'spark');
  }
  Object.entries(connections).forEach(([id, c]) => {
    if (Number(id) !== fromId && c.open) c.send({ type: 'impact', from: fromId, kind: data.kind, id: data.id, x: data.x, y: data.y });
  });
}

function handleCollect(fromId, coinId) {
  const idx = coins.findIndex(c => c.id === coinId);
  if (idx === -1) return;
  const c = coins[idx];
  coins.splice(idx, 1);
  if (players[fromId]) players[fromId].score += COIN_VALUE;
  spawnExplosion(c.x, c.y, 'coin');
  broadcast({ type: 'coinRemove', id: coinId, x: c.x, y: c.y });
  broadcastRoster();
}

function handleDied(fromId, killerId) {
  if (players[fromId]) { players[fromId].alive = false; players[fromId].deaths = (players[fromId].deaths || 0) + 1; }
  if (players[killerId] && killerId !== fromId) {
    players[killerId].kills = (players[killerId].kills || 0) + 1;
    players[killerId].score += KILL_SCORE;
  }
  broadcast({ type: 'killed', victim: fromId, killer: killerId });
  onKilled(killerId, fromId);
  broadcastRoster();
}

function spawnInitialCoins() {
  coins = [];
  for (let i = 0; i < COIN_CAP; i++) spawnOneCoin();
}
function spawnOneCoin() {
  const p = randomSpawnPoint();
  const coin = { id: 'c' + (coinCounter++), x: p.x, y: p.y };
  coins.push(coin);
  return coin;
}
function hostMaybeSpawnCoin(ts) {
  if (!isHost || !started) return;
  if (ts - lastSpawnTick < COIN_SPAWN_EVERY) return;
  lastSpawnTick = ts;
  if (coins.length < COIN_CAP) {
    const coin = spawnOneCoin();
    broadcast({ type: 'coinAdd', coin });
  }
}

// ================= Networking: client side =================
function startJoin() {
  unlockAudio();
  const hostId = document.getElementById('hostIdInput').value.trim();
  if (!hostId) return;
  peer = new Peer();
  peer.on('open', () => {
    const conn = peer.connect(hostId, { reliable: true });
    connections.host = conn;
    conn.on('open', () => {
      chooseRole.style.display = 'none'; lobby.style.display = 'flex';
      statusEl.textContent = 'Connected — waiting for host...';
      startBtn.style.display = 'none'; waitHint.style.display = 'block';
    });
    conn.on('data', handleClientReceive);
  });
}

function handleClientReceive(data) {
  if (data.type === 'full') { statusEl.textContent = 'That lobby is full.'; }
  else if (data.type === 'welcome') {
    myId = data.id;
    players[myId] = freshPlayerState(myId, myName);
    connections.host.send({ type: 'name', name: myName });
  }
  else if (data.type === 'roster') {
    data.roster.forEach(p => { players[p.id] = players[p.id] || {}; Object.assign(players[p.id], p); });
    renderLobby(); renderLeaderboard();
  }
  else if (data.type === 'coins') coins = data.list;
  else if (data.type === 'coinAdd') coins.push(data.coin);
  else if (data.type === 'coinRemove') {
    coins = coins.filter(c => c.id !== data.id);
    if (data.x != null) spawnExplosion(data.x, data.y, 'coin');
  }
  else if (data.type === 'start') { started = true; buildClouds(); beginLocalGame(); }
  else if (data.type === 'state') {
    const p = players[data.from] = players[data.from] || freshPlayerState(data.from, 'Player ' + (data.from + 1));
    applyRemoteState(p, data);
  }
  else if (data.type === 'shoot') {
    if (data.from !== myId) {
      bullets.push({ id: data.id, ownerId: data.from, x: data.x, y: data.y, prevX: data.x, prevY: data.y, angle: data.angle, born: performance.now() });
      spawnExplosion(data.x, data.y, 'muzzle');
    }
  }
  else if (data.type === 'missile') {
    if (data.from !== myId) {
      missiles.push({ id: data.id, ownerId: data.from, targetId: data.targetId, x: data.x, y: data.y, angle: data.angle, born: performance.now(), trail: [] });
      spawnExplosion(data.x, data.y, 'launch');
    }
  }
  else if (data.type === 'flare') {
    if (data.from !== myId) {
      flares.push({ x: data.x, y: data.y, born: performance.now() });
      resolveFlare(data.from, data.x, data.y);
    }
  }
  else if (data.type === 'impact') {
    if (data.from !== myId) {
      removeProjectileLocal(data.kind, data.id);
      spawnExplosion(data.x, data.y, data.kind === 'missile' ? 'blast' : 'spark');
    }
  }
  else if (data.type === 'killed') onKilled(data.killer, data.victim);
}

function sendEvent(msg) {
  if (isHost) {
    if (msg.type === 'state') handleState(0, msg);
    else if (msg.type === 'shoot') handleShoot(0, msg);
    else if (msg.type === 'missile') handleMissile(0, msg);
    else if (msg.type === 'flare') handleFlare(0, msg);
    else if (msg.type === 'impact') handleImpact(0, msg);
    else if (msg.type === 'collect') handleCollect(0, msg.id);
    else if (msg.type === 'died') handleDied(0, msg.by);
  } else if (connections.host && connections.host.open) {
    connections.host.send(msg);
  }
}

// ================= UI: lobby / leaderboard / kill feed =================
function renderLobby() {
  lobbyList.innerHTML = '';
  Object.values(players).sort((a, b) => a.id - b.id).forEach(p => {
    const li = document.createElement('li');
    if (p.connected === false) li.className = 'offline';
    li.innerHTML = `<span>${escapeHtml(p.name || ('Player ' + (p.id + 1)))}</span><span>${p.connected === false ? 'left' : 'ready'}</span>`;
    lobbyList.appendChild(li);
  });
}

function renderLeaderboard() {
  if (!lbListEl) return;
  const top = Object.values(players).filter(p => p.connected !== false).sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 6);
  lbListEl.innerHTML = '';
  top.forEach(p => {
    const li = document.createElement('li');
    if (p.id === myId) li.className = 'me';
    li.innerHTML = `<span>${escapeHtml(p.name || 'Player')}</span><span>${p.score || 0}</span>`;
    lbListEl.appendChild(li);
  });
}

function pushKillFeed(killerId, victimId) {
  if (!killFeedEl) return;
  const killer = players[killerId], victim = players[victimId];
  const kName = killer ? killer.name : 'Someone';
  const vName = victim ? victim.name : 'someone';
  const div = document.createElement('div');
  div.className = 'kill-msg';
  div.textContent = (killerId === victimId || killerId == null) ? `${vName} crashed` : `${kName} shot down ${vName}`;
  killFeedEl.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

// Runs once per client per death (see handleDied and the 'killed' branch of
// handleClientReceive) so the kill feed message and crash explosion always
// fire together, exactly once, on every machine including the victim's own.
function onKilled(killerId, victimId) {
  pushKillFeed(killerId, victimId);
  const v = players[victimId];
  if (v) spawnExplosion(v.x, v.y, 'crash');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

// ================= Input =================
const keysHeld = { boost: false, shoot: false };
let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2 - 150; // aim point; steering targets this each frame

function resetAllInput() { keysHeld.boost = false; keysHeld.shoot = false; }
window.addEventListener('blur', resetAllInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetAllInput(); });

function wireKeyboard() {
  document.addEventListener('keydown', e => {
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': keysHeld.boost = true; break;
      case ' ': keysHeld.shoot = true; e.preventDefault(); break;
      case 'q': case 'Q': tryFireMissile(); break;
      case 'f': case 'F': tryDeployFlare(); break;
    }
  });
  document.addEventListener('keyup', e => {
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': keysHeld.boost = false; break;
      case ' ': keysHeld.shoot = false; break;
    }
  });
}

function wireMouse() {
  window.addEventListener('mousemove', e => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener('mousedown', e => {
    if (e.button === 0) keysHeld.shoot = true;
    else if (e.button === 2) tryFireMissile();
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) keysHeld.shoot = false; });
  window.addEventListener('contextmenu', e => e.preventDefault());
}

// ================= Rendering =================
function resizeCanvas() {
  skyCanvas.width = window.innerWidth;
  skyCanvas.height = window.innerHeight;
}

// ---- Vector plane silhouette -------------------------------------------------
// The original raster F-16 was beautiful but too detailed for a 74px sprite.
// This compact silhouette is drawn at runtime, so it stays sharp, readable,
// and easy to tint for every pilot without needing an external image asset.
const PLANE_SPRITE_LEN = 88;
function drawPlaneSprite(ctx, color, alive) {
  const main = alive ? color : '#566875';
  const dark = alive ? '#082238' : '#273844';
  const highlight = alive ? '#d8f5ff' : '#83939a';
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = alive ? color : 'transparent'; ctx.shadowBlur = alive ? 9 : 0;
  // soft engine glow
  if (alive) { ctx.fillStyle = 'rgba(255,176,91,.72)'; ctx.beginPath(); ctx.moveTo(-34,-4); ctx.lineTo(-49,0); ctx.lineTo(-34,4); ctx.closePath(); ctx.fill(); }
  ctx.shadowBlur = 0;
  // wings and tailplane
  ctx.fillStyle = dark; ctx.strokeStyle = 'rgba(217,247,255,.7)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(8,-3); ctx.lineTo(-8,-25); ctx.lineTo(-18,-24); ctx.lineTo(-11,-4); ctx.lineTo(-33,-11); ctx.lineTo(-37,-8); ctx.lineTo(-19,1); ctx.lineTo(-37,8); ctx.lineTo(-33,11); ctx.lineTo(-11,4); ctx.lineTo(-18,24); ctx.lineTo(-8,25); ctx.lineTo(8,3); ctx.closePath(); ctx.fill(); ctx.stroke();
  // fuselage
  ctx.fillStyle = main; ctx.strokeStyle = highlight;
  ctx.beginPath(); ctx.moveTo(42,0); ctx.quadraticCurveTo(28,-5,10,-5); ctx.lineTo(-23,-4); ctx.lineTo(-35,0); ctx.lineTo(-23,4); ctx.lineTo(10,5); ctx.quadraticCurveTo(28,5,42,0); ctx.closePath(); ctx.fill(); ctx.stroke();
  // canopy and center spine
  ctx.fillStyle = alive ? '#183c5a' : '#37484f'; ctx.strokeStyle = 'rgba(225,250,255,.75)';
  ctx.beginPath(); ctx.moveTo(18,-4); ctx.quadraticCurveTo(9,-13,-3,-5); ctx.lineTo(7,-2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.beginPath(); ctx.moveTo(-27,0); ctx.lineTo(29,0); ctx.stroke();
  // nose point and tail fin
  ctx.fillStyle = highlight; ctx.beginPath(); ctx.moveTo(42,0); ctx.lineTo(29,-2); ctx.lineTo(29,2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.moveTo(-20,-4); ctx.lineTo(-13,-16); ctx.lineTo(-7,-5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawPlane(ctx, p, isMe, now) {
  const flicker = now < p.invulnUntil && Math.floor(now / 100) % 2 === 0;
  ctx.save();
  const kick = isMe ? recoilKick : 0;
  ctx.translate(p.x - Math.cos(p.angle) * kick, p.y - Math.sin(p.angle) * kick);
  ctx.rotate(p.angle);
  ctx.globalAlpha = flicker ? 0.4 : 1;
  drawPlaneSprite(ctx, p.color || colorFor(p.id), p.alive !== false);
  ctx.restore();

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText((isMe ? '' : '') + (p.name || 'Player'), p.x, p.y - 34);

  const w = 30, h = 4, frac = clamp((p.health != null ? p.health : 100) / MAX_HEALTH, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(p.x - w / 2, p.y - 28, w, h);
  ctx.fillStyle = frac > 0.4 ? '#6fe08a' : '#ff6b6b';
  ctx.fillRect(p.x - w / 2, p.y - 28, w * frac, h);
}

function drawCoin(ctx, c, now) {
  const bob = Math.sin(now / 300 + c.x) * 2;
  ctx.save();
  ctx.translate(c.x, c.y + bob);
  ctx.fillStyle = '#ffd166';
  ctx.strokeStyle = '#a9700a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a1 = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const a2 = a1 + Math.PI / 5;
    ctx.lineTo(Math.cos(a1) * 8, Math.sin(a1) * 8);
    ctx.lineTo(Math.cos(a2) * 3.2, Math.sin(a2) * 3.2);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawBullet(ctx, b) {
  ctx.save();
  ctx.strokeStyle = b.ownerId === myId ? 'rgba(255,244,155,.8)' : 'rgba(255,125,90,.65)';
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(b.prevX ?? b.x, b.prevY ?? b.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.angle);
  ctx.shadowColor = b.ownerId === myId ? '#fff59d' : '#ff6548'; ctx.shadowBlur = 10;
  ctx.fillStyle = b.ownerId === myId ? '#fffbd0' : '#ff987d';
  ctx.beginPath();
  ctx.ellipse(0, 0, BULLET_RADIUS * 3.4, BULLET_RADIUS, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawMissile(ctx, m) {
  const incoming = m.targetId === myId && m.ownerId !== myId;
  if (incoming) {
    const pulse = 22 + Math.sin(performance.now() / 90) * 5;
    ctx.save(); ctx.globalAlpha = .28; ctx.strokeStyle = '#ff4558'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(m.x, m.y, pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < m.trail.length; i++) {
    const t = m.trail[i];
    const frac = (i + 1) / (m.trail.length + 1);
    ctx.fillStyle = `rgba(255,${Math.round(110 + frac * 110)},${Math.round(45 + frac * 80)},${frac * .55})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 2 + frac * 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(m.angle);
  ctx.shadowColor = m.decoyed ? '#9aa5b1' : '#ff6138'; ctx.shadowBlur = 16;
  ctx.fillStyle = m.decoyed ? '#9aa5b1' : '#eef1f5';
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff4f2e';
  ctx.beginPath(); ctx.moveTo(-8,-3); ctx.lineTo(-22,0); ctx.lineTo(-8,3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffb347';
  ctx.beginPath();
  ctx.moveTo(-7, -1.6);
  ctx.lineTo(-12, 0);
  ctx.lineTo(-7, 1.6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFlare(ctx, f, now) {
  const frac = clamp(1 - (now - f.born) / FLARE_ACTIVE_MS, 0, 1);
  if (frac <= 0) return;
  ctx.save();
  ctx.globalAlpha = frac;
  const grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, 26);
  grad.addColorStop(0, 'rgba(255,240,180,0.95)');
  grad.addColorStop(1, 'rgba(255,140,60,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(f.x, f.y, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawExplosion(ctx, e, now) {
  const cfg = FX[e.kind];
  const t = clamp((now - e.born) / cfg.life, 0, 1);
  const r = cfg.r * (0.3 + t * 0.7);
  ctx.save();
  ctx.globalAlpha = 1 - t;
  const grad = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
  grad.addColorStop(0, cfg.colors[0]);
  grad.addColorStop(0.45, cfg.colors[1]);
  grad.addColorStop(1, cfg.colors[2]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  ctx.fill();
  if (e.kind === 'blast' || e.kind === 'crash' || e.kind === 'shock') {
    ctx.globalAlpha = (1 - t) * .85; ctx.strokeStyle = e.kind === 'shock' ? '#9ceeff' : '#ffbd5d'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(e.x, e.y, r * (.55 + t * .65), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawGround(ctx) {
  const grad = ctx.createLinearGradient(0, GROUND_Y, 0, WORLD_H);
  grad.addColorStop(0, '#2f7fb0');
  grad.addColorStop(0.35, '#1f5f8f');
  grad.addColorStop(1, '#0d3455');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, WORLD_H);
  ctx.lineTo(0, GROUND_Y);
  const step = 120;
  for (let x = 0; x <= WORLD_W; x += step) {
    const h = Math.sin(x / 260) * 6 + Math.sin(x / 90 + 1.3) * 3;
    ctx.lineTo(x, GROUND_Y + h);
  }
  ctx.lineTo(WORLD_W, GROUND_Y);
  ctx.lineTo(WORLD_W, WORLD_H);
  ctx.closePath();
  ctx.fill();

  // Wave-line highlight along the surface
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let x = 0; x <= WORLD_W; x += step) {
    const h = Math.sin(x / 260) * 6 + Math.sin(x / 90 + 1.3) * 3;
    if (x === 0) ctx.moveTo(x, GROUND_Y + h); else ctx.lineTo(x, GROUND_Y + h);
  }
  ctx.stroke();

  // A couple of fainter, slightly submerged wave lines for texture
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1.5;
  [18, 40].forEach((depth, di) => {
    ctx.beginPath();
    for (let x = 0; x <= WORLD_W; x += step) {
      const h = Math.sin(x / 260 + di + 1) * 5 + Math.sin(x / 100 + di * 2) * 3;
      if (x === 0) ctx.moveTo(x, GROUND_Y + depth + h); else ctx.lineTo(x, GROUND_Y + depth + h);
    }
    ctx.stroke();
  });
}

function drawSpeedLines(ctx, now) {
  if (!myState || !keysHeld.boost || !myState.alive) return;
  ctx.save();
  ctx.translate(myState.x, myState.y); ctx.rotate(myState.angle);
  ctx.globalAlpha = .24 + Math.sin(now / 90) * .05;
  for (let i = 0; i < 9; i++) {
    const y = (i - 4) * 13 + Math.sin(now / 170 + i) * 4;
    const length = 20 + ((i * 17) % 33);
    ctx.strokeStyle = i % 2 ? '#b9f8ff' : '#6edff2'; ctx.lineWidth = i % 3 === 0 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(-48 - length, y); ctx.lineTo(-48, y); ctx.stroke();
  }
  ctx.restore();
}

function render(now) {
  const ctx = skyCtx;
  const W = skyCanvas.width, H = skyCanvas.height;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#071828'); grad.addColorStop(0.42, '#15506d'); grad.addColorStop(1, '#8dc4d4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Atmospheric bands make the arena feel deeper before the camera moves.
  const glow = ctx.createRadialGradient(W * .7, H * .25, 0, W * .7, H * .25, H * .75);
  glow.addColorStop(0, 'rgba(108,224,239,.18)'); glow.addColorStop(1, 'rgba(108,224,239,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  const shakeX = (Math.random() - .5) * screenShake;
  const shakeY = (Math.random() - .5) * screenShake;
  const camX = myState.x - W / 2, camY = myState.y - H / 2;
  ctx.save();
  ctx.translate(-camX + shakeX, -camY + shakeY);

  stars.forEach(s => {
    if (s.x < camX - 10 || s.x > camX + W + 10 || s.y < camY - 10 || s.y > camY + H + 10) return;
    ctx.globalAlpha = s.a * (0.65 + Math.sin(now / 900 + s.x) * .25);
    ctx.fillStyle = '#d8f7ff'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  clouds.forEach(c => {
    if (c.x < camX - 100 || c.x > camX + W + 100 || c.y < camY - 100 || c.y > camY + H + 100) return;
    ctx.fillStyle = `rgba(255,255,255,${c.a})`;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
  });

  drawGround(ctx);
  drawSpeedLines(ctx, now);

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, WORLD_H);
  ctx.moveTo(WORLD_W, 0); ctx.lineTo(WORLD_W, WORLD_H);
  ctx.moveTo(0, 0); ctx.lineTo(WORLD_W, 0);
  ctx.stroke();

  coins.forEach(c => drawCoin(ctx, c, now));
  flares.forEach(f => drawFlare(ctx, f, now));
  bullets.forEach(b => drawBullet(ctx, b));
  missiles.forEach(m => drawMissile(ctx, m));

  Object.values(players).forEach(p => {
    if (p.id === myId) return;
    if (p.connected === false) return;
    drawPlane(ctx, p, false, now);
  });
  drawPlane(ctx, myState, true, now);

  explosions.forEach(e => drawExplosion(ctx, e, now));

  ctx.restore();

  drawMinimap(now);
}

function drawMinimap(now) {
  const ctx = miniCtx, W = miniCanvas.width, H = miniCanvas.height;
  const scaleX = W / WORLD_W, scaleY = H / WORLD_H;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(20,30,50,0.4)';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(31,95,143,0.7)';
  ctx.fillRect(0, GROUND_Y * scaleY, W, H - GROUND_Y * scaleY);

  coins.forEach(c => {
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(c.x * scaleX - 1, c.y * scaleY - 1, 2, 2);
  });
  Object.values(players).forEach(p => {
    if (p.connected === false || p.alive === false) return;
    ctx.fillStyle = p.id === myId ? '#fff' : (p.color || colorFor(p.id));
    ctx.beginPath();
    ctx.arc(p.x * scaleX, p.y * scaleY, p.id === myId ? 3 : 2.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function interpolateRemotePlayers(dtSec) {
  const t = Math.min(1, REMOTE_SMOOTH * dtSec);
  Object.values(players).forEach(p => {
    if (p.id === myId || p.connected === false || p.tx === undefined) return;
    p.x += (p.tx - p.x) * t;
    p.y += (p.ty - p.y) * t;
    p.angle += angleDiff(p.angle, p.tangle) * t;
  });
}

// ================= Game loop =================
function beginLocalGame() {
  menu.style.display = 'none'; gameArea.style.display = 'block';
  myState = createLocalState();
  players[myId] = myState;
  wireKeyboard();
  wireMouse();
  startEngineAudio();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  requestAnimationFrame(loop);
}

let lastTime = 0, lastBroadcast = 0;

function loop(ts) {
  const dt = Math.min(lastTime ? ts - lastTime : 16, 60);
  lastTime = ts;
  const dtSec = dt / 1000;
  screenShake = Math.max(0, screenShake - dtSec * 34);
  recoilKick = Math.max(0, recoilKick - dtSec * 28);
  updateEngineAudio();
  const boostingNow = keysHeld.boost && myState && myState.boost > 0;
  if (boostingNow && !wasBoosting) playAsset('flyby', .28, 1.18);
  wasBoosting = boostingNow;

  updateLocalPlane(dtSec, keysHeld);
  updateBullets(dtSec);
  updateMissiles(dtSec);
  pruneFlares(ts);
  pruneExplosions(ts);
  interpolateRemotePlayers(dtSec);
  hostMaybeSpawnCoin(ts);

  if (ts - lastBroadcast > 66) {
    lastBroadcast = ts;
    sendEvent({ type: 'state', x: myState.x, y: myState.y, angle: myState.angle, health: myState.health, alive: myState.alive });
  }

  hpFillEl.style.width = clamp((myState.health / MAX_HEALTH) * 100, 0, 100) + '%';
  boostFillEl.style.width = clamp((myState.boost / BOOST_MAX) * 100, 0, 100) + '%';
  heatFillEl.style.width = clamp((myState.heat / HEAT_MAX) * 100, 0, 100) + '%';
  heatFillEl.classList.toggle('overheat', myState.overheated);
  scoreValEl.textContent = myState.score || 0;
  killsValEl.textContent = myState.kills || 0;
  missileCountEl.textContent = 'MISSILES  ' + myState.missiles + '/' + MISSILE_MAX;
  flareCountEl.textContent = 'FLARES  ' + myState.flares + '/' + FLARE_MAX;

  const incomingLock = missiles.some(m => m.targetId === myId && m.ownerId !== myId);
  if (incomingLock && !lastIncomingLock) { unlockAudio(); playLockSound(); }
  lastIncomingLock = incomingLock;
  lockWarningEl.style.display = incomingLock ? 'block' : 'none';
  gameArea.classList.toggle('missile-lock', incomingLock);

  if (!myState.alive && myState.respawnAt) {
    const remain = Math.max(0, myState.respawnAt - performance.now());
    respawnTimerEl.textContent = 'Respawning in ' + (remain / 1000).toFixed(1) + 's';
  }

  render(ts);
  requestAnimationFrame(loop);
}

// ================= Boot =================
window.addEventListener('DOMContentLoaded', () => {
  chooseRole = document.getElementById('chooseRole');
  lobby = document.getElementById('lobby');
  menu = document.getElementById('menu');
  gameArea = document.getElementById('gameArea');
  statusEl = document.getElementById('status');
  lobbyList = document.getElementById('lobbyList');
  startBtn = document.getElementById('startBtn');
  waitHint = document.getElementById('waitHint');

  skyCanvas = document.getElementById('sky');
  skyCtx = skyCanvas.getContext('2d');
  miniCanvas = document.getElementById('minimap');
  miniCtx = miniCanvas.getContext('2d');

  hpFillEl = document.getElementById('hpFill');
  boostFillEl = document.getElementById('boostFill');
  heatFillEl = document.getElementById('heatFill');
  scoreValEl = document.getElementById('scoreVal');
  killsValEl = document.getElementById('killsVal');
  missileCountEl = document.getElementById('missileCount');
  flareCountEl = document.getElementById('flareCount');
  lockWarningEl = document.getElementById('lockWarning');
  lbListEl = document.getElementById('lbList');
  killFeedEl = document.getElementById('killFeed');
  respawnOverlay = document.getElementById('respawnOverlay');
  respawnMsgEl = document.getElementById('respawnMsg');
  respawnTimerEl = document.getElementById('respawnTimer');

  document.getElementById('hostBtn').onclick = () => { captureName(); startHost(); };
  document.getElementById('joinBtn').onclick = () => { captureName(); startJoin(); };
});

function captureName() {
  const v = document.getElementById('nameInput').value.trim();
  if (v) myName = v.slice(0, 14);
}
