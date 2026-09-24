// ---- Setup ----
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const PADDLE_W = 12, PADDLE_H = 90, BALL_SIZE = 12, SPEED = 7;

let role = null;      // 'host' or 'client'
let peer = null;
let conn = null;
let remoteInput = 0;  // input received from the other player

let state = {
  ball: { x: W / 2, y: H / 2, vx: 5, vy: 3 },
  hostY: H / 2 - PADDLE_H / 2,
  clientY: H / 2 - PADDLE_H / 2,
  score: { host: 0, client: 0 }
};

// ---- Input ----
const keys = {};
document.addEventListener('keydown', e => (keys[e.key] = true));
document.addEventListener('keyup', e => (keys[e.key] = false));

function readInput() {
  if (keys['ArrowUp'] || keys['w'] || keys['W']) return -1;
  if (keys['ArrowDown'] || keys['s'] || keys['S']) return 1;
  return 0;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---- UI wiring ----
const menu = document.getElementById('menu');
const statusEl = document.getElementById('status');
document.getElementById('hostBtn').onclick = startHost;
document.getElementById('joinBtn').onclick = startJoin;

function startHost() {
  role = 'host';
  peer = new Peer();

  peer.on('open', id => {
    statusEl.textContent = 'Share this code with your friend: ' + id;
  });

  peer.on('connection', c => {
    conn = c;
    wireConnection();
    statusEl.textContent = 'Connected! Starting game...';
    setTimeout(() => {
      menu.style.display = 'none';
      requestAnimationFrame(hostLoop);
    }, 500);
  });

  peer.on('error', err => {
    statusEl.textContent = 'Error: ' + err.type;
  });
}

function startJoin() {
  role = 'client';
  const hostId = document.getElementById('hostIdInput').value.trim();
  if (!hostId) {
    statusEl.textContent = 'Enter the code your friend gave you first.';
    return;
  }
  peer = new Peer();

  peer.on('open', () => {
    conn = peer.connect(hostId, { reliable: false });
    conn.on('open', () => {
      wireConnection();
      menu.style.display = 'none';
      requestAnimationFrame(clientLoop);
    });
  });

  peer.on('error', err => {
    statusEl.textContent = 'Error: ' + err.type;
  });
}

function wireConnection() {
  conn.on('data', data => {
    if (role === 'host' && data.type === 'input') {
      remoteInput = data.dir;
    } else if (role === 'client' && data.type === 'state') {
      state = data.state;
    }
  });
  conn.on('close', () => {
    statusEl.textContent = 'Connection lost.';
  });
}

// ---- Host: authoritative simulation ----
function hostLoop() {
  const myInput = readInput();
  state.hostY = clamp(state.hostY + myInput * SPEED, 0, H - PADDLE_H);
  state.clientY = clamp(state.clientY + remoteInput * SPEED, 0, H - PADDLE_H);

  const b = state.ball;
  b.x += b.vx;
  b.y += b.vy;

  if (b.y <= 0 || b.y >= H - BALL_SIZE) b.vy *= -1;

  // left paddle collision
  if (
    b.x <= PADDLE_W &&
    b.y + BALL_SIZE >= state.hostY &&
    b.y <= state.hostY + PADDLE_H &&
    b.vx < 0
  ) {
    b.vx *= -1.05;
    b.x = PADDLE_W;
  }

  // right paddle collision
  if (
    b.x >= W - PADDLE_W - BALL_SIZE &&
    b.y + BALL_SIZE >= state.clientY &&
    b.y <= state.clientY + PADDLE_H &&
    b.vx > 0
  ) {
    b.vx *= -1.05;
    b.x = W - PADDLE_W - BALL_SIZE;
  }

  if (b.x < 0) {
    state.score.client++;
    resetBall(1);
  } else if (b.x > W) {
    state.score.host++;
    resetBall(-1);
  }

  if (conn && conn.open) conn.send({ type: 'state', state });
  draw();
  requestAnimationFrame(hostLoop);
}

function resetBall(dir) {
  state.ball = { x: W / 2, y: H / 2, vx: 5 * dir, vy: Math.random() * 4 - 2 };
}

// ---- Client: sends input, renders host's state ----
function clientLoop() {
  const myInput = readInput();
  if (conn && conn.open) conn.send({ type: 'input', dir: myInput });
  draw();
  requestAnimationFrame(clientLoop);
}

// ---- Rendering ----
function draw() {
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, state.hostY, PADDLE_W, PADDLE_H);
  ctx.fillRect(W - PADDLE_W, state.clientY, PADDLE_W, PADDLE_H);
  ctx.fillRect(state.ball.x, state.ball.y, BALL_SIZE, BALL_SIZE);

  ctx.font = '32px monospace';
  ctx.fillText(state.score.host, W / 2 - 60, 40);
  ctx.fillText(state.score.client, W / 2 + 40, 40);
}

draw();
