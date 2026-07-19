'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - blue
  '#ffb74d', // L - orange
  '#b0bec5', // 8 - tuerca (gris acero)
  '#fff176', // 9 - rayo (amarillo eléctrico)
  '#ff5722', // 10 - bomba (naranja/rojo)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                   // Tuerca (hueco central)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const LOCK_DELAY = 500;      // ms que la pieza espera apoyada antes de fijarse
const MAX_LOCK_RESETS = 15;  // reinicios máximos por mover/rotar (evita stalling infinito)
const POWER_UP_LINES = 10;   // líneas eliminadas necesarias para que aparezca el rayo
const BOMB_CHANCE = 0.05;    // probabilidad de que una pieza generada sea una bomba
const EXPLOSION_MS = 450;    // duración de la animación de explosión
const MAX_ENERGY = 8;        // líneas acumuladas para llenar la barra de energía
const PREVIEW_COUNT = 5;     // piezas visibles en la cola de "siguientes"
const REVEAL_MS = 10000;     // duración del panel de "próximas 5" al activarse

// Modo desafíos: cada entrada define un objetivo de líneas contra un límite de
// tiempo. Agregar un nuevo desafío es solo añadir una entrada a este array.
const CHALLENGES = [
  {
    id: 'sprint40',
    name: 'Sprint 40',
    description: 'Limpia 40 líneas en 2 minutos',
    goalLines: 40,
    timeLimit: 120000, // ms
  },
];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const comboEl = document.getElementById('combo');
const comboPopup = document.getElementById('combo-popup');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const menuBtn = document.getElementById('menu-btn');
const themeToggle = document.getElementById('theme-toggle');
const startScreen = document.getElementById('start-screen');
const modeClassicBtn = document.getElementById('mode-classic');
const challengeListEl = document.getElementById('challenge-list');
const challengeHud = document.getElementById('challenge-hud');
const challengeTimerEl = document.getElementById('challenge-timer');
const challengeGoalEl = document.getElementById('challenge-goal');
const energyBarEl = document.getElementById('energy-bar');
const energyFillEl = document.getElementById('energy-fill');
const holdCanvas = document.getElementById('hold-canvas');
const holdCtx = holdCanvas.getContext('2d');
const abilityMenu = document.getElementById('ability-menu');
const abilityListEl = document.getElementById('ability-list');
const queuePreviewEl = document.getElementById('queue-preview');
const queueCanvas = document.getElementById('queue-canvas');
const queueCtx = queueCanvas.getContext('2d');

const THEME_KEY = 'tetris-theme';
let gridLineColor = '#22222e';

let board, current, nextQueue, score, lines, level, combo, paused, gameOver, lastTime, dropAccum, dropInterval, animId, lockTimer, lockResets, pendingPower, linesUntilPower;
let mode, activeChallenge, challengeElapsed, challengeDone;
let energy, held, abilityMenuOpen, revealRemaining;
let explosions;

// Habilidades cargables: cada entrada define su ejecución. Añadir una nueva
// habilidad es solo agregar un objeto a este array; el menú se genera solo.
const ABILITIES = [
  { id: 'hold', name: 'HOLD', description: 'Reserva / intercambia la pieza actual', execute: doHold },
  { id: 'next5', name: 'PRÓXIMAS 5', description: 'Revela las 5 piezas siguientes por 10s', execute: doRevealNext },
];

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

// Reconstruye una pieza de spawn a partir de un tipo guardado (usado por Hold).
function pieceFromType(type) {
  if (type === 9) return lightningPiece();
  if (type === 10) return bombPiece();
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

// Pieza especial de rayo: no forma parte de PIECES, así que randomPiece() nunca
// la genera por azar. Se entrega manualmente cada POWER_UP_LINES líneas.
function lightningPiece() {
  return { type: 9, shape: [[9]], x: Math.floor(COLS / 2), y: 0, special: true, power: 'zap' };
}

// Pieza especial de bomba: aparece al azar (ver BOMB_CHANCE en refillQueue) y
// destruye un área de 3x3 a su alrededor al fijarse.
function bombPiece() {
  return { type: 10, shape: [[10]], x: Math.floor(COLS / 2), y: 0, special: true, power: 'bomb' };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      onPieceMoved();
      return;
    }
  }
}

// Reinicia el temporizador de bloqueo cuando la pieza se mueve/rota estando
// apoyada, dando margen para deslizarla bajo un saliente antes de fijarse.
function onPieceMoved() {
  if (collide(current.shape, current.x, current.y + 1) && lockResets < MAX_LOCK_RESETS) {
    lockTimer = 0;
    lockResets++;
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    combo++;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level * combo;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    if (combo > 1) showComboPopup(`COMBO x${combo}`);
    energy = Math.min(MAX_ENERGY, energy + cleared);
    linesUntilPower -= cleared;
    if (linesUntilPower <= 0) {
      pendingPower = true;
      linesUntilPower += POWER_UP_LINES;
    }
  } else {
    combo = 0;
  }
  updateHUD();
  if (mode === 'challenge' && !challengeDone && lines >= activeChallenge.goalLines) {
    endChallenge(true);
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    lockResets = 0;
    updateHUD();
  }
  // Si está apoyada, no se bloquea al instante: el lock delay de loop() se
  // encarga, dejando margen para deslizarla de lado bajo un saliente.
}

function lockPiece() {
  if (current.special) {
    if (current.power === 'bomb') bomb();
    else zap();
  } else {
    merge();
    clearLines();
  }
  if (gameOver || challengeDone) return; // el desafío/partida ya terminó al limpiar líneas
  spawn();
}

// Efecto del rayo: limpia por completo la fila y la columna donde cae (cruz),
// dejando hueco (no colapsa el resto del tablero).
function zap() {
  const col = current.x, row = current.y;
  let removed = 0;
  for (let r = 0; r < ROWS; r++) {
    if (board[r][col]) { board[r][col] = 0; removed++; }
  }
  for (let c = 0; c < COLS; c++) {
    if (board[row][c]) { board[row][c] = 0; removed++; }
  }
  score += removed * 50 * level;
  combo = 0;
  updateHUD();
  showComboPopup('⚡ RAYO');
}

// Efecto de la bomba: limpia un área de 3x3 centrada en su posición, dejando
// hueco (no colapsa el resto del tablero).
function bomb() {
  const cx = current.x, cy = current.y;
  let removed = 0;
  for (let r = cy - 1; r <= cy + 1; r++) {
    for (let c = cx - 1; c <= cx + 1; c++) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      if (board[r][c]) { board[r][c] = 0; removed++; }
    }
  }
  score += removed * 60 * level;
  combo = 0;
  spawnExplosion(cx, cy);
  updateHUD();
  showComboPopup('💥 BOMBA');
}

// Mantiene la cola de "siguientes" siempre llena con PREVIEW_COUNT piezas. Cada
// pieza nueva tiene una probabilidad BOMB_CHANCE de ser una bomba.
function refillQueue() {
  while (nextQueue.length < PREVIEW_COUNT) {
    nextQueue.push(Math.random() < BOMB_CHANCE ? bombPiece() : randomPiece());
  }
}

// Extrae la próxima pieza de la cola. Si hay un rayo pendiente por líneas
// acumuladas, lo inserta al frente de la cola (misma semántica que antes:
// se ve venir en el preview y cae en el siguiente spawn).
function advanceQueue() {
  const piece = nextQueue.shift();
  if (pendingPower) {
    nextQueue.unshift(lightningPiece());
    pendingPower = false;
  }
  refillQueue();
  if (revealRemaining > 0) drawQueuePreview();
  return piece;
}

function spawn() {
  current = advanceQueue();
  dropAccum = 0;
  lockTimer = 0;
  lockResets = 0;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = combo > 1 ? `x${combo}` : '—';
  energyFillEl.style.width = `${(energy / MAX_ENERGY) * 100}%`;
  energyBarEl.classList.toggle('full', energy >= MAX_ENERGY);
  if (mode === 'challenge') {
    challengeGoalEl.textContent = `${Math.min(lines, activeChallenge.goalLines)} / ${activeChallenge.goalLines}`;
  }
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toggleChallengeHUD(show) {
  challengeHud.classList.toggle('hidden', !show);
}

let comboPopupTimer = null;

function showComboPopup(text) {
  comboPopup.textContent = text;
  comboPopup.classList.remove('hidden', 'show');
  // Restart the animation even if a previous combo popup is still fading.
  void comboPopup.offsetWidth;
  comboPopup.classList.add('show');
  clearTimeout(comboPopupTimer);
  comboPopupTimer = setTimeout(() => comboPopup.classList.add('hidden'), 700);
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridLineColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  drawExplosions();
}

// Registra una explosión para animar en los próximos frames de draw().
function spawnExplosion(cx, cy) {
  explosions.push({ x: cx, y: cy, start: performance.now() });
}

// Dibuja una onda expansiva + partículas para cada explosión activa y descarta
// las que ya expiraron. Se llama en cada draw(), así que la animación avanza
// sola con el requestAnimationFrame del loop principal.
function drawExplosions() {
  if (!explosions.length) return;
  const now = performance.now();
  explosions = explosions.filter(exp => now - exp.start < EXPLOSION_MS);
  for (const exp of explosions) {
    const t = (now - exp.start) / EXPLOSION_MS;
    const cx = (exp.x + 0.5) * BLOCK;
    const cy = (exp.y + 0.5) * BLOCK;
    const radius = BLOCK * 0.6 + t * BLOCK * 2.2;

    ctx.save();
    ctx.globalAlpha = 1 - t;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    gradient.addColorStop(0, 'rgba(255,241,182,0.95)');
    gradient.addColorStop(0.45, 'rgba(255,140,40,0.85)');
    gradient.addColorStop(1, 'rgba(255,61,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // partículas radiales
    const particleCount = 8;
    ctx.fillStyle = `rgba(255,183,77,${1 - t})`;
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const dist = t * BLOCK * 2.5;
      const px = cx + Math.cos(angle) * dist;
      const py = cy + Math.sin(angle) * dist;
      ctx.beginPath();
      ctx.arc(px, py, Math.max(0, 3 - t * 3), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = nextQueue[0].shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// Dibuja las PREVIEW_COUNT piezas de la cola apiladas verticalmente, para el
// panel temporal de la habilidad "PRÓXIMAS 5".
function drawQueuePreview() {
  const NB = 18;
  const slotH = queueCanvas.height / PREVIEW_COUNT;
  queueCtx.clearRect(0, 0, queueCanvas.width, queueCanvas.height);
  for (let i = 0; i < PREVIEW_COUNT; i++) {
    const piece = nextQueue[i];
    if (!piece) continue;
    const shape = piece.shape;
    const offX = (queueCanvas.width / NB - shape[0].length) / 2;
    const offY = i * (slotH / NB) + (slotH / NB - shape.length) / 2;
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        drawBlock(queueCtx, offX + c, offY + r, shape[r][c], NB);
  }
}

function drawHold() {
  const NB = 30;
  holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
  if (held === null) return;
  const shape = PIECES[held].map(row => [...row]);
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(holdCtx, offX + c, offY + r, shape[r][c], NB);
}

// Reserva la pieza actual o la intercambia con la reservada previamente.
function doHold() {
  const currentType = current.type;
  if (held === null) {
    held = currentType;
    current = advanceQueue();
  } else {
    const swapType = held;
    held = currentType;
    current = pieceFromType(swapType);
  }
  dropAccum = 0;
  lockTimer = 0;
  lockResets = 0;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawHold();
  drawNext();
}

// Habilidad: revela las próximas PREVIEW_COUNT piezas por REVEAL_MS ms.
function doRevealNext() {
  revealRemaining = REVEAL_MS;
  queuePreviewEl.classList.remove('hidden');
  drawQueuePreview();
}

function renderAbilityMenu() {
  abilityListEl.innerHTML = '';
  for (const ability of ABILITIES) {
    const btn = document.createElement('button');
    btn.className = 'challenge-btn';
    btn.textContent = `${ability.name} — ${ability.description}`;
    btn.addEventListener('click', () => useAbility(ability));
    abilityListEl.appendChild(btn);
  }
}

function openAbilityMenu() {
  if (paused || gameOver || abilityMenuOpen) return;
  if (energy < MAX_ENERGY) return;
  abilityMenuOpen = true;
  cancelAnimationFrame(animId);
  abilityMenu.classList.remove('hidden');
}

function closeAbilityMenu() {
  abilityMenuOpen = false;
  abilityMenu.classList.add('hidden');
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

function useAbility(ability) {
  abilityMenuOpen = false;
  abilityMenu.classList.add('hidden');
  energy = 0;
  updateHUD();
  ability.execute();
  draw();
  lastTime = performance.now();
  animId = requestAnimationFrame(loop);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  if (mode === 'challenge' && !challengeDone) {
    challengeDone = true;
    overlayTitle.textContent = 'DESAFÍO FALLIDO';
    overlayScore.textContent = `${lines} / ${activeChallenge.goalLines} líneas — Puntuación: ${score.toLocaleString()}`;
  } else {
    overlayTitle.textContent = 'GAME OVER';
    overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  }
  overlay.classList.remove('hidden');
}

// Fin del desafío por objetivo cumplido o por tiempo agotado (game over lo
// maneja endGame() reutilizando el mensaje de fallo).
function endChallenge(success) {
  challengeDone = true;
  gameOver = true;
  cancelAnimationFrame(animId);
  if (success) {
    overlayTitle.textContent = '¡DESAFÍO COMPLETADO!';
    overlayScore.textContent = `Tiempo: ${formatTime(challengeElapsed)} — Puntuación: ${score.toLocaleString()}`;
  } else {
    overlayTitle.textContent = 'DESAFÍO FALLIDO';
    overlayScore.textContent = `${lines} / ${activeChallenge.goalLines} líneas — Puntuación: ${score.toLocaleString()}`;
  }
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver || abilityMenuOpen) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (revealRemaining > 0) {
    revealRemaining -= dt;
    if (revealRemaining <= 0) {
      revealRemaining = 0;
      queuePreviewEl.classList.add('hidden');
    }
  }
  if (mode === 'challenge' && !challengeDone) {
    challengeElapsed += dt;
    if (challengeElapsed >= activeChallenge.timeLimit) {
      challengeElapsed = activeChallenge.timeLimit;
      challengeTimerEl.textContent = formatTime(0);
      endChallenge(false);
      return; // endChallenge() ya canceló el loop; no dibujar/reprogramar
    }
    challengeTimerEl.textContent = formatTime(activeChallenge.timeLimit - challengeElapsed);
  }
  if (!collide(current.shape, current.x, current.y + 1)) {
    // En el aire: cae por gravedad normal, sin lock delay.
    lockTimer = 0;
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      current.y++;
      lockResets = 0;
    }
  } else {
    // Apoyada: espera el lock delay antes de fijarse, dando tiempo para
    // deslizarla de lado bajo un saliente y rellenar huecos.
    dropAccum = 0;
    lockTimer += dt;
    if (lockTimer >= LOCK_DELAY) {
      lockTimer = 0;
      lockPiece();
    }
  }
  if (gameOver || paused) return; // endGame() already cancelled the loop; don't draw/reschedule
  draw();
  animId = requestAnimationFrame(loop);
}

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme === 'light');
  gridLineColor = getComputedStyle(document.body).getPropertyValue('--grid-line').trim() || gridLineColor;
  if (themeToggle) themeToggle.checked = theme === 'light';
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

themeToggle?.addEventListener('change', () => {
  applyTheme(themeToggle.checked ? 'light' : 'dark');
  draw();
  drawNext();
});

function init(newMode, challenge) {
  mode = newMode ?? mode ?? 'classic';
  activeChallenge = challenge ?? activeChallenge ?? null;
  challengeElapsed = 0;
  challengeDone = false;
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  combo = 0;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lockTimer = 0;
  lockResets = 0;
  pendingPower = false;
  linesUntilPower = POWER_UP_LINES;
  energy = 0;
  held = null;
  abilityMenuOpen = false;
  abilityMenu.classList.add('hidden');
  revealRemaining = 0;
  explosions = [];
  queuePreviewEl.classList.add('hidden');
  lastTime = performance.now();
  nextQueue = [];
  refillQueue();
  spawn();
  drawHold();
  updateHUD();
  toggleChallengeHUD(mode === 'challenge');
  if (mode === 'challenge') {
    challengeTimerEl.textContent = formatTime(activeChallenge.timeLimit);
    challengeGoalEl.textContent = `0 / ${activeChallenge.goalLines}`;
  }
  overlay.classList.add('hidden');
  startScreen.classList.add('hidden');
  comboPopup.classList.add('hidden');
  clearTimeout(comboPopupTimer);
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

function startClassic() {
  init('classic', null);
}

function startChallenge(challenge) {
  init('challenge', challenge);
}

function showStartScreen() {
  gameOver = true; // evita que el loop en curso (si lo hubiera) siga corriendo
  cancelAnimationFrame(animId);
  overlay.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

function renderChallengeList() {
  challengeListEl.innerHTML = '';
  for (const challenge of CHALLENGES) {
    const btn = document.createElement('button');
    btn.className = 'challenge-btn';
    btn.textContent = `${challenge.name} — ${challenge.description}`;
    btn.addEventListener('click', () => startChallenge(challenge));
    challengeListEl.appendChild(btn);
  }
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
    if (abilityMenuOpen) closeAbilityMenu();
    else openAbilityMenu();
    return;
  }
  if (e.code === 'Escape' && abilityMenuOpen) { closeAbilityMenu(); return; }
  if (paused || gameOver || abilityMenuOpen) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; onPieceMoved(); }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; onPieceMoved(); }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => init(mode, activeChallenge));
menuBtn.addEventListener('click', showStartScreen);
modeClassicBtn.addEventListener('click', startClassic);

initTheme();
renderChallengeList();
renderAbilityMenu();
showStartScreen();
