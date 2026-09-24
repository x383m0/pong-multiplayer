// ================= Constants =================
const COLS = 10, ROWS = 20, BLOCK = 24;
const NEXT_BLOCK = 20;
const MINI_BLOCK = 12; // opponent preview (120/10 = 12, 240/20 = 12)

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

// lines cleared at once -> garbage lines sent to opponent
const GARBAGE_TABLE = { 1: 0, 2: 1, 3: 2, 4: 4 };
const SCORE_TABLE = { 1: 100, 2: 300, 3: 500, 4: 800 };

// ================= Helpers =================
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

// ================= Game state factory =================
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
    gameOver: false,
    sentGameOver: false
  };
}

function spawnPiece(state) {
  const name = state.next;
  state.next = randomPiece();
  const matrix = SHAPES[name].map(row => row.slice());
  const col = Math.floor((COLS - matrix[0].length) / 2);
  const piece = { name, matrix, row: -1, col };

  // apply any garbage that piled up while the last piece was falling
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

function lockPiece(state, sendGarbage) {
  const p = state.piece;
  for (let r = 0; r < p.matrix.length; r++) {
    for (let c = 0; c < p.matrix[r].length; c++) {
      if (p.matrix[r][c] && p.row + r >= 0) {
        state.board[p.row + r][p.col + c] = COLORS[p.name];
      }
    }
  }

  // clear full rows
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (state.board[r].every(cell => cell)) {
      state.board.splice(r, 1);
      state.board.unshift(Array(COLS).fill(null));
      cleared++;
      r++; // re-check same index after shift
    }
  }

  if (cleared > 0) {
    state.lines += cleared;
    state.score += SCORE_TABLE[cleared] || 0;
    state.level = Math.floor(state.lines / 10);
    state.dropInterval = Math.max(120, 800 - state.level * 70);
    const garbage = GARBAGE_TABLE[cleared] || 0;
    if (garbage > 0) sendGarbage(garbage);
  }

  if (!state.gameOver) spawnPiece(state);
}

function hardDrop(state, sendGarbage) {
  if (state.gameOver || !state.piece) return;
  const p = state.piece;
  while (!collide(state.board, p.matrix, p.row + 1, p.col)) p.row++;
  state.score += 2;
  lockPiece(state, sendGarbage);
}

function softDropStep(state, sendGarbage) {
  if (!tryMove(state, 1, 0)) {
    lockPiece(state, sendGarbage);
  } else {
    state.score += 1;
  }
}

function update(state, dt, keysHeld, sendGarbage) {
  if (state.gameOver || !state.piece) return;
  const interval = keysHeld.down ? Math.max(40, state.dropInterval / 12) : state.dropInterval;
  state.dropTimer += dt;
  if (state.dropTimer >= interval) {
    state.dropTimer = 0;
    if (!tryMove(state, 1, 0)) {
      lockPiece(state, sendGarbage);
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

// ================= Networking + game orchestration =================
const myCanvas = document.getElementById('myBoard');
const myCtx = myCanvas.getContext('2d');
const nextCanvas = document.getElementById('nextPiece');
const nextCtx = nextCanvas.getContext('2d');
const oppCanvas = document.getElementById('oppBoard');
const oppCtx = oppCanvas.getContext('2d');

const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const resultEl = document.getElementById('resultMsg');
const menu = document.getElementById('menu');
const gameArea = document.getElementById('gameArea');
const statusEl = document.getElementById('status');

let peer = null;
let conn = null;
let myState = null;
let oppBoard = null; // last board snapshot received from opponent
let oppPiece = null;
let matchOver = false;

const keysHeld = { left: false, right: false, down: false };
const das = { left: { timer: 0, fired: false }, right: { timer: 0, fired: false } };

document.getElementById('hostBtn').onclick = startHost;
document.getElementById('joinBtn').onclick = startJoin;

function startHost() {
  peer = new Peer();
  peer.on('open', id => {
    statusEl.textContent = 'Share this code with your friend: ' + id;
  });
  peer.on('connection', c => {
    conn = c;
    wireConnection();
    statusEl.textContent = 'Connected! Starting game...';
    setTimeout(beginGame, 400);
  });
  peer.on('error', err => { statusEl.textContent = 'Error: ' + err.type; });
}

function startJoin() {
  const hostId = document.getElementById('hostIdInput').value.trim();
  if (!hostId) { statusEl.textContent = "Enter the code your friend gave you first."; return; }
  peer = new Peer();
  peer.on('open', () => {
    conn = peer.connect(hostId, { reliable: true });
    conn.on('open', () => {
      wireConnection();
      beginGame();
    });
  });
  peer.on('error', err => { statusEl.textContent = 'Error: ' + err.type; });
}

function wireConnection() {
  conn.on('data', data => {
    if (data.type === 'state') {
      oppBoard = data.board;
      oppPiece = data.piece;
    } else if (data.type === 'garbage') {
      myState.pendingGarbage += data.amount;
    } else if (data.type === 'gameover') {
      if (!matchOver) {
        matchOver = true;
        showResult(true); // opponent topped out first -> I win
      }
    }
  });
  conn.on('close', () => { statusEl.textContent = 'Connection lost.'; });
}

function sendGarbage(amount) {
  if (conn && conn.open) conn.send({ type: 'garbage', amount });
}

function beginGame() {
  menu.style.display = 'none';
  gameArea.style.display = 'flex';
  myState = newGame();
  spawnPiece(myState);
  wireKeyboard();
  requestAnimationFrame(loop);
}

function wireKeyboard() {
  document.addEventListener('keydown', e => {
    if (!myState || myState.gameOver) return;
    switch (e.key) {
      case 'ArrowLeft':
        keysHeld.left = true;
        if (!e.repeat) tryMove(myState, 0, -1);
        e.preventDefault();
        break;
      case 'ArrowRight':
        keysHeld.right = true;
        if (!e.repeat) tryMove(myState, 0, 1);
        e.preventDefault();
        break;
      case 'ArrowDown':
        keysHeld.down = true;
        e.preventDefault();
        break;
      case 'ArrowUp':
        if (!e.repeat) tryRotate(myState);
        e.preventDefault();
        break;
      case ' ':
        if (!e.repeat) hardDrop(myState, sendGarbage);
        e.preventDefault();
        break;
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'ArrowLeft') keysHeld.left = false;
    if (e.key === 'ArrowRight') keysHeld.right = false;
    if (e.key === 'ArrowDown') keysHeld.down = false;
  });
}

function handleDAS(dt) {
  if (keysHeld.left) {
    das.left.timer += dt;
    const threshold = das.left.fired ? 50 : 170;
    if (das.left.timer >= threshold) {
      tryMove(myState, 0, -1);
      das.left.timer = 0;
      das.left.fired = true;
    }
  } else {
    das.left.timer = 0;
    das.left.fired = false;
  }

  if (keysHeld.right) {
    das.right.timer += dt;
    const threshold = das.right.fired ? 50 : 170;
    if (das.right.timer >= threshold) {
      tryMove(myState, 0, 1);
      das.right.timer = 0;
      das.right.fired = true;
    }
  } else {
    das.right.timer = 0;
    das.right.fired = false;
  }
}

let lastTime = 0;
let lastBroadcast = 0;
let wasGameOver = false;

function loop(ts) {
  const dt = lastTime ? ts - lastTime : 16;
  lastTime = ts;

  if (!matchOver) {
    handleDAS(dt);
    update(myState, dt, keysHeld, sendGarbage);

    if (myState.gameOver && !wasGameOver) {
      wasGameOver = true;
      if (conn && conn.open) conn.send({ type: 'gameover' });
      if (!matchOver) { matchOver = true; showResult(false); }
    }

    // throttle state broadcasts to ~15/sec
    if (ts - lastBroadcast > 66 && conn && conn.open) {
      lastBroadcast = ts;
      conn.send({ type: 'state', board: myState.board, piece: myState.piece });
    }
  }

  scoreEl.textContent = myState.score;
  linesEl.textContent = myState.lines;

  drawBoardToCtx(myCtx, myState.board, myState.piece, BLOCK, myCanvas.width, myCanvas.height);
  drawNext(nextCtx, myState.next);
  if (oppBoard) drawBoardToCtx(oppCtx, oppBoard, oppPiece, MINI_BLOCK, oppCanvas.width, oppCanvas.height);

  requestAnimationFrame(loop);
}

function showResult(won) {
  resultEl.textContent = won ? 'You Win! 🎉' : 'Game Over — You Lose';
  resultEl.className = 'result ' + (won ? 'win' : 'lose');
}
