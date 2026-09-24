// ================= Constants =================
const COLS = 10, ROWS = 20, BLOCK = 24;
const NEXT_BLOCK = 20;
const MINI_BLOCK = 8;
const MAX_PLAYERS = 4;

const COLORS = {
  I: '#22d3ee', O: '#facc15', T: '#a78bfa',
  S: '#4ade80', Z: '#f87171', J: '#60a5fa', L: '#fb923c'
};

const SHAPES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]]
};
const PIECE_NAMES = Object.keys(SHAPES);

const GARBAGE_TABLE = { 1: 0, 2: 1, 3: 2, 4: 4 };
const SCORE_TABLE = { 1: 100, 2: 300, 3: 500, 4: 800 };

// ================= Tetris core (per-player, runs locally only) =================
function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function rotateMatrix(m) {
  const N = m.length;
  const res = Array.from({ length: N }, () => Array(N).fill(0));
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) res[c][N - 1 - r] = m[r][c];
  return res;
}

function randomPiece() {
  return PIECE_NAMES[Math.floor(Math.random() * PIECE_NAMES.length)];
}

function collide(board, matrix, row, col) {
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (!matrix[r][c]) continue;
      const br = row + r, bc = col + c;
      if (bc < 0 || bc >= COLS || br >= ROWS) return true;
      if (br >= 0 && board[br][bc]) return true;
    }
  }
  return false;
}

function newGame() {
  return {
    board: emptyBoard(),
    piece: null,
    next: randomPiece(),
    score: 0,
    lines: 0,
    level: 0,
    dropInterval: 800,
    dropTimer: 0,
    pendingGarbage: 0,
    gameOver: false
  };
}

function spawnPiece(state) {
  const name = state.next;
  state.next = randomPiece();
  const matrix = SHAPES[name].map(row => row.slice());
  const col = Math.floor((COLS - matrix[0].length) / 2);
  const piece = { name, matrix, row: -1, col };

  if (state.pendingGarbage > 0) {
    addGarbageRows(state.board, state.pendingGarbage);
    state.pendingGarbage = 0;
  }

  if (collide(state.board, matrix, piece.row, piece.col)) {
    state.gameOver = true;
  }
  state.piece = piece;
}

function addGarbageRows(board, n) {
  for (let i = 0; i < n; i++) {
    board.shift();
    const gap = Math.floor(Math.random() * COLS);
    const row = Array(COLS).fill('#475569');
    row[gap] = null;
    board.push(row);
  }
}

function tryMove(state, dRow, dCol) {
  if (state.gameOver || !state.piece) return false;
  const p = state.piece;
  if (!collide(state.board, p.matrix, p.row + dRow, p.col + dCol)) {
    p.row += dRow;
    p.col += dCol;
    return true;
  }
  return false;
}

function tryRotate(state) {
  if (state.gameOver || !state.piece) return;
  const p = state.piece;
  const rotated = rotateMatrix(p.matrix);
  const kicks = [0, -1, 1, -2, 2];
  for (const k of kicks) {
    if (!collide(state.board, rotated, p.row, p.col + k)) {
      p.matrix = rotated;
      p.col += k;
      return;
    }
  }
}

function lockPiece(state, onLinesCleared) {
  const p = state.piece;
  for (let r = 0; r < p.matrix.length; r++) {
    for (let c = 0; c < p.matrix[r].length; c++) {
      if (p.matrix[r][c] && p.row + r >= 0) {
        state.board[p.row + r][p.col + c] = COLORS[p.name];
      }
    }
  }

  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (state.board[r].every(cell => cell)) {
      state.board.splice(r, 1);
      state.board.unshift(Array(COLS).fill(null));
      cleared++;
      r++;
    }
  }

  if (cleared > 0) {
    state.lines += cleared;
    state.score += SCORE_TABLE[cleared] || 0;
    state.level = Math.floor(state.lines / 10);
    state.dropInterval = Math.max(120, 800 - state.level * 70);
    const garbage = GARBAGE_TABLE[cleared] || 0;
    if (garbage > 0) onLinesCleared(garbage);
  }

  if (!state.gameOver) spawnPiece(state);
}

function hardDrop(state, onLinesCleared) {
  if (state.gameOver || !state.piece) return;
  const p = state.piece;
  while (!collide(state.board, p.matrix, p.row + 1, p.col)) p.row++;
  state.score += 2;
  lockPiece(state, onLinesCleared);
}

function update(state, dt, keysHeld, onLinesCleared) {
  if (state.gameOver || !state.piece) return;
  const interval = keysHeld.down ? Math.max(40, state.dropInterval / 12) : state.dropInterval;
  state.dropTimer += dt;
  if (state.dropTimer >= interval) {
    state.dropTimer = 0;
    if (!tryMove(state, 1, 0)) {
      lockPiece(state, onLinesCleared);
    } else if (keysHeld.down) {
      state.score += 1;
    }
  }
}

// ================= Rendering =================
function drawBoardToCtx(ctx, board, piece, block, w, h) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c]) {
        ctx.fillStyle = board[r][c];
        ctx.fillRect(c * block, r * block, block - 1, block - 1);
      }
    }
  }

  if (piece) {
    ctx.fillStyle = COLORS[piece.name];
    for (let r = 0; r < piece.matrix.length; r++) {
      for (let c = 0; c < piece.matrix[r].length; c++) {
        if (piece.matrix[r][c] && piece.row + r >= 0) {
          ctx.fillRect((piece.col + c) * block, (piece.row + r) * block, block - 1, block - 1);
        }
      }
    }
  }
}

function drawNext(ctx, name) {
  ctx.clearRect(0, 0, 96, 96);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 96, 96);
  if (!name) return;
  const matrix = SHAPES[name];
  ctx.fillStyle = COLORS[name];
  const offsetX = (96 - matrix[0].length * NEXT_BLOCK) / 2;
  const offsetY = (96 - matrix.length * NEXT_BLOCK) / 2;
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix[r].length; c++) {
      if (matrix[r][c]) {
        ctx.fillRect(offsetX + c * NEXT_BLOCK, offsetY + r * NEXT_BLOCK, NEXT_BLOCK - 1, NEXT_BLOCK - 1);
      }
    }
  }
}

// ================= DOM refs =================
const myCanvas = document.getElementById('myBoard');
const myCtx = myCanvas.getContext('2d');
const nextCanvas = document.getElementById('nextPiece');
const nextCtx = nextCanvas.getContext('2d');
const oppBoardsEl = document.getElementById('oppBoards');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const resultEl = document.getElementById('resultMsg');
const chooseRole = document.getElementById('chooseRole');
const lobby = document.getElementById('lobby');
const lobbyList = document.getElementById('lobbyList');
const startBtn = document.getElementById('startBtn');
const menu = document.getElementById('menu');
const gameArea = document.getElementById('gameArea');
const statusEl = document.getElementById('status');

// ================= Networking state =================
let peer = null;
let isHost = false;
let myId = null;
let connections = {};      // host: {1: conn, 2: conn, 3: conn}. client: {host: conn}
let players = {};          // id -> {id, connected, alive, board, piece, name}
let started = false;
let myGame = null;
let winnerId = null;

function nextFreeId() {
  for (let i = 1; i < MAX_PLAYERS; i++) {
    if (!players[i] || players[i].connected === false) return i;
  }
  return null;
}

function broadcast(msg) {
  Object.values(connections).forEach(c => { if (c && c.open) c.send(msg); });
}

function renderLobby() {
  lobbyList.innerHTML = '';
  Object.values(players).forEach(p => {
    const li = document.createElement('li');
    li.textContent = (p.id === myId ? 'You' : 'Player ' + (p.id + 1)) +
      (p.connected === false ? ' (disconnected)' : '');
    lobbyList.appendChild(li);
  });
  if (isHost) {
    const connectedCount = Object.values(players).filter(p => p.connected !== false).length;
    startBtn.style.display = 'inline-block';
    startBtn.disabled = connectedCount < 2;
  }
}

// ---------- Host ----------
function startHost() {
  isHost = true;
  myId = 0;
  players[0] = { id: 0, connected: true, alive: true };
  peer = new Peer();

  peer.on('open', id => {
    statusEl.textContent = 'Share this code with your friends: ' + id;
    chooseRole.style.display = 'none';
    lobby.style.display = 'flex';
    renderLobby();
  });

  peer.on('connection', c => {
    const id = nextFreeId();
    if (id === null) { c.on('open', () => c.send({ type: 'full' })); return; }
    connections[id] = c;
    players[id] = { id, connected: true, alive: true };

    c.on('open', () => {
      c.send({ type: 'welcome', id });
      broadcastRoster();
    });
    c.on('data', data => handleHostReceive(id, data));
    c.on('close', () => {
      if (players[id]) players[id].connected = false;
      broadcastRoster();
      checkWinner();
    });
  });

  peer.on('error', err => { statusEl.textContent = 'Error: ' + err.type; });

  startBtn.onclick = () => {
    started = true;
    broadcast({ type: 'start' });
    beginLocalGame();
  };
}

function broadcastRoster() {
  renderLobby();
  broadcast({ type: 'roster', roster: rosterSnapshot() });
}

function rosterSnapshot() {
  return Object.values(players).map(p => ({ id: p.id, connected: p.connected, alive: p.alive }));
}

function handleHostReceive(fromId, data) {
  if (data.type === 'state') {
    players[fromId].board = data.board;
    players[fromId].piece = data.piece;
    Object.entries(connections).forEach(([id, c]) => {
      if (Number(id) !== fromId && c.open) c.send({ type: 'state', from: fromId, board: data.board, piece: data.piece });
    });
  } else if (data.type === 'garbage') {
    routeGarbage(fromId, data.to, data.amount);
  } else if (data.type === 'eliminated') {
    players[fromId].alive = false;
    broadcast({ type: 'eliminated', from: fromId });
    checkWinner();
  }
}

function routeGarbage(fromId, toId, amount) {
  if (toId === 0) {
    myGame.pendingGarbage += amount;
  } else if (connections[toId] && connections[toId].open) {
    connections[toId].send({ type: 'garbage', from: fromId, to: toId, amount });
  }
}

function checkWinner() {
  if (!isHost || winnerId !== null) return;
  const totalKnown = Object.keys(players).length;
  const alive = Object.values(players).filter(p => p.connected !== false && p.alive);
  if (totalKnown > 1 && alive.length <= 1) {
    winnerId = alive.length === 1 ? alive[0].id : null;
    broadcast({ type: 'winner', id: winnerId });
    announceResult(winnerId);
  }
}

// ---------- Client ----------
function startJoin() {
  const hostId = document.getElementById('hostIdInput').value.trim();
  if (!hostId) { statusEl.textContent = "Enter the code your friend gave you first."; return; }
  peer = new Peer();
  peer.on('open', () => {
    const conn = peer.connect(hostId, { reliable: true });
    connections['host'] = conn;
    conn.on('open', () => {
      chooseRole.style.display = 'none';
      lobby.style.display = 'flex';
      statusEl.textContent = 'Connected! Waiting for host to start...';
    });
    conn.on('data', data => handleClientReceive(data));
    conn.on('close', () => { statusEl.textContent = 'Connection to host lost.'; });
  });
  peer.on('error', err => { statusEl.textContent = 'Error: ' + err.type; });
}

function handleClientReceive(data) {
  if (data.type === 'welcome') {
    myId = data.id;
    players[myId] = { id: myId, connected: true, alive: true };
  } else if (data.type === 'full') {
    statusEl.textContent = 'That game is already full (4 players max).';
  } else if (data.type === 'roster') {
    data.roster.forEach(p => { players[p.id] = players[p.id] || {}; Object.assign(players[p.id], p); });
    renderLobby();
  } else if (data.type === 'start') {
    started = true;
    beginLocalGame();
  } else if (data.type === 'state') {
    players[data.from] = players[data.from] || { id: data.from, connected: true, alive: true };
    players[data.from].board = data.board;
    players[data.from].piece = data.piece;
  } else if (data.type === 'garbage') {
    myGame.pendingGarbage += data.amount;
  } else if (data.type === 'eliminated') {
    if (players[data.from]) players[data.from].alive = false;
  } else if (data.type === 'winner') {
    announceResult(data.id);
  }
}

// ---------- Shared: sending my own events ----------
function sendEvent(msg) {
  if (isHost) {
    if (msg.type === 'state') {
      broadcast({ type: 'state', from: 0, board: msg.board, piece: msg.piece });
    } else if (msg.type === 'garbage') {
      routeGarbage(0, msg.to, msg.amount);
    } else if (msg.type === 'eliminated') {
      players[0].alive = false;
      broadcast({ type: 'eliminated', from: 0 });
      checkWinner();
    }
  } else if (connections.host && connections.host.open) {
    connections.host.send(msg);
  }
}

function pickTarget() {
  const targets = Object.values(players).filter(p => p.id !== myId && p.connected !== false && p.alive);
  if (!targets.length) return null;
  return targets[Math.floor(Math.random() * targets.length)].id;
}

// ================= Input handling (fixed) =================
const keysHeld = { left: false, right: false, down: false };
const pressedOnce = new Set(); // guards rotate / hard drop against duplicate keydown events
const das = { left: { timer: 0, fired: false }, right: { timer: 0, fired: false } };

function resetAllInput() {
  keysHeld.left = false;
  keysHeld.right = false;
  keysHeld.down = false;
  pressedOnce.clear();
  das.left.timer = 0; das.left.fired = false;
  das.right.timer = 0; das.right.fired = false;
}

// Clear stuck keys the instant focus is lost — this is what was causing
// the "moved 5 steps" bug: a missed keyup after alt-tabbing/losing focus
// left a key stuck "held" until something else reset it.
window.addEventListener('blur', resetAllInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) resetAllInput(); });

function wireKeyboard() {
  document.addEventListener('keydown', e => {
    if (!myGame || myGame.gameOver) return;
    switch (e.key) {
      case 'ArrowLeft':
        if (!keysHeld.left) { keysHeld.left = true; tryMove(myGame, 0, -1); das.left.timer = 0; das.left.fired = false; }
        e.preventDefault();
        break;
      case 'ArrowRight':
        if (!keysHeld.right) { keysHeld.right = true; tryMove(myGame, 0, 1); das.right.timer = 0; das.right.fired = false; }
        e.preventDefault();
        break;
      case 'ArrowDown':
        keysHeld.down = true;
        e.preventDefault();
        break;
      case 'ArrowUp':
        if (!pressedOnce.has('up')) { pressedOnce.add('up'); tryRotate(myGame); }
        e.preventDefault();
        break;
      case ' ':
        // Manual one-shot guard: only fires once per physical press,
        // regardless of the browser's own key-repeat behavior.
        if (!pressedOnce.has('space')) {
          pressedOnce.add('space');
          hardDrop(myGame, onLinesCleared);
        }
        e.preventDefault();
        break;
    }
  });

  document.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft') { keysHeld.left = false; das.left.timer = 0; das.left.fired = false; }
    if (e.key === 'ArrowRight') { keysHeld.right = false; das.right.timer = 0; das.right.fired = false; }
    if (e.key === 'ArrowDown') keysHeld.down = false;
    if (e.key === 'ArrowUp') pressedOnce.delete('up');
    if (e.key === ' ') pressedOnce.delete('space');
  });
}

function handleDAS(dt) {
  if (keysHeld.left) {
    das.left.timer += dt;
    const threshold = das.left.fired ? 50 : 170;
    if (das.left.timer >= threshold) {
      tryMove(myGame, 0, -1);
      das.left.timer = 0;
      das.left.fired = true;
    }
  }
  if (keysHeld.right) {
    das.right.timer += dt;
    const threshold = das.right.fired ? 50 : 170;
    if (das.right.timer >= threshold) {
      tryMove(myGame, 0, 1);
      das.right.timer = 0;
      das.right.fired = true;
    }
  }
}

function onLinesCleared(amount) {
  const target = pickTarget();
  if (target !== null) sendEvent({ type: 'garbage', to: target, amount });
}

// ================= Game loop =================
function buildOppSlots() {
  oppBoardsEl.innerHTML = '';
  Object.values(players)
    .filter(p => p.id !== myId)
    .sort((a, b) => a.id - b.id)
    .forEach(p => {
      const wrap = document.createElement('div');
      wrap.className = 'opp-slot';
      wrap.id = 'opp-slot-' + p.id;
      const label = document.createElement('span');
      label.textContent = 'Player ' + (p.id + 1);
      const canvas = document.createElement('canvas');
      canvas.width = COLS * MINI_BLOCK;
      canvas.height = ROWS * MINI_BLOCK;
      canvas.id = 'opp-canvas-' + p.id;
      wrap.appendChild(canvas);
      wrap.appendChild(label);
      oppBoardsEl.appendChild(wrap);
    });
}

function beginLocalGame() {
  menu.style.display = 'none';
  gameArea.style.display = 'flex';
  myGame = newGame();
  spawnPiece(myGame);
  buildOppSlots();
  wireKeyboard();
  requestAnimationFrame(loop);
}

function announceResult(id) {
  winnerId = id;
  if (id === myId) {
    resultEl.textContent = 'You Win! 🎉';
    resultEl.className = 'result win';
  } else {
    resultEl.textContent = 'Game Over — Player ' + (id !== null ? id + 1 : '?') + ' Wins';
    resultEl.className = 'result lose';
  }
}

let lastTime = 0;
let lastBroadcast = 0;
let announcedOut = false;

function loop(ts) {
  // Cap dt so a lag spike or tab-switch can never be "caught up" in one
  // big jump — this is the other half of the movement-precision fix.
  const dt = Math.min(lastTime ? ts - lastTime : 16, 100);
  lastTime = ts;

  if (winnerId === null) {
    if (!myGame.gameOver) {
      handleDAS(dt);
      update(myGame, dt, keysHeld, onLinesCleared);

      if (myGame.gameOver && !announcedOut) {
        announcedOut = true;
        sendEvent({ type: 'eliminated' });
        resultEl.textContent = "You're out — waiting for the match to finish...";
        resultEl.className = 'result lose';
      }
    }

    if (ts - lastBroadcast > 66) {
      lastBroadcast = ts;
      sendEvent({ type: 'state', board: myGame.board, piece: myGame.piece });
    }
  }

  scoreEl.textContent = myGame.score;
  linesEl.textContent = myGame.lines;

  drawBoardToCtx(myCtx, myGame.board, myGame.piece, BLOCK, myCanvas.width, myCanvas.height);
  drawNext(nextCtx, myGame.next);

  Object.values(players).filter(p => p.id !== myId).forEach(p => {
    const canvas = document.getElementById('opp-canvas-' + p.id);
    const slot = document.getElementById('opp-slot-' + p.id);
    if (!canvas) return;
    if (slot) slot.classList.toggle('eliminated', p.alive === false);
    if (p.board) drawBoardToCtx(canvas.getContext('2d'), p.board, p.piece, MINI_BLOCK, canvas.width, canvas.height);
  });

  requestAnimationFrame(loop);
}

// ================= Wire up menu buttons =================
document.getElementById('hostBtn').onclick = startHost;
document.getElementById('joinBtn').onclick = startJoin;
