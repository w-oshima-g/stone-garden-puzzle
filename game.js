// Stone Garden (石庭) - Main Game Engine
// Sokoban-style puzzle game with Zen garden theme

(function() {
'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────
const TILE = 48;
const TILE_HALF = TILE / 2;

const T = {
  VOID:    'X',
  WALL:    '#',
  FLOOR:   ' ',
  PLAYER:  '@',
  STONE:   '$',
  GOAL:    '.',
  STONE_ON_GOAL: '*',
  PLAYER_ON_GOAL: '+',
};

const SCREENS = { TITLE: 'title', WORLD_SELECT: 'world', LEVEL_SELECT: 'level', GAME: 'game', CLEAR: 'clear', WORLD_CLEAR: 'worldclear', GAME_CLEAR: 'gameclear' };

// ─── Canvas setup ───────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let W = 0, H = 0;
function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const scale = Math.min(vw / 800, vh / 600);
  W = Math.round(800 * scale);
  H = Math.round(600 * scale);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
}
window.addEventListener('resize', () => { resize(); draw(); });
resize();

// ─── State ─────────────────────────────────────────────────────────────────
let screen = SCREENS.TITLE;
let currentWorld = 0;
let currentLevel = 0;
let grid = [];
let playerPos = { x: 0, y: 0 };
let moveCount = 0;
let history = [];
let sandTrails = []; // { x, y, dir, age }
let particles = []; // celebration particles
let animTick = 0;
let titleAnimY = 0;
let titleFade = 0; // 0..1
let levelTransitionAlpha = 0;
let levelTransitionDir = 0; // 1=in, -1=out
let lastMoveDir = null;
let shakeDuration = 0;
let shakeIntensity = 0;
let completionAnimation = 0; // 0..1
let worldSelectScroll = 0;
let levelSelectHighlight = 0;
let titleCursor = 0; // menu cursor on title

// Progress save
let saveData = loadSave();

function loadSave() {
  try {
    const d = JSON.parse(localStorage.getItem('stonegarden_save') || '{}');
    if (!d.cleared) d.cleared = {};
    if (!d.bestMoves) d.bestMoves = {};
    return d;
  } catch(e) { return { cleared: {}, bestMoves: {} }; }
}

function savePersist() {
  try { localStorage.setItem('stonegarden_save', JSON.stringify(saveData)); } catch(e) {}
}

function levelKey(w, l) { return w + '_' + l; }

function isCleared(w, l) { return !!saveData.cleared[levelKey(w, l)]; }
function isWorldUnlocked(w) {
  if (w === 0) return true;
  // Unlock next world when all levels in prev world cleared
  const wData = WORLDS[w - 1];
  return wData.levels.every((_, i) => isCleared(w - 1, i));
}
function isLevelUnlocked(w, l) {
  if (l === 0) return isWorldUnlocked(w);
  return isCleared(w, l - 1);
}

// ─── Level loading ──────────────────────────────────────────────────────────
function loadLevel(worldIdx, levelIdx) {
  currentWorld = worldIdx;
  currentLevel = levelIdx;
  const lvl = WORLDS[worldIdx].levels[levelIdx];
  const rawMap = lvl.map;

  // Parse map
  grid = rawMap.map(row => row.split(''));
  sandTrails = [];
  particles = [];
  history = [];
  moveCount = 0;
  completionAnimation = 0;
  lastMoveDir = null;
  shakeDuration = 0;

  // Find player
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const c = grid[y][x];
      if (c === T.PLAYER || c === T.PLAYER_ON_GOAL) {
        playerPos = { x, y };
      }
    }
  }
}

// ─── Game logic ─────────────────────────────────────────────────────────────
function cellAt(x, y) {
  if (y < 0 || y >= grid.length) return T.VOID;
  if (x < 0 || x >= grid[y].length) return T.VOID;
  return grid[y][x];
}

function setCell(x, y, v) {
  if (y >= 0 && y < grid.length && x >= 0 && x < grid[y].length) {
    grid[y][x] = v;
  }
}

function isWalkable(c) { return c === T.FLOOR || c === T.GOAL || c === T.PLAYER || c === T.PLAYER_ON_GOAL; }
function isPushable(c) { return c === T.STONE || c === T.STONE_ON_GOAL; }

function tryMove(dx, dy) {
  if (completionAnimation > 0) return;

  const nx = playerPos.x + dx;
  const ny = playerPos.y + dy;
  const ahead = cellAt(nx, ny);

  // Save state for undo
  const snapshot = { grid: grid.map(r => [...r]), pos: { ...playerPos }, moveCount };
  history.push(snapshot);
  if (history.length > 200) history.shift();

  let moved = false;

  if (isWalkable(ahead)) {
    // Simple move
    movePlayer(nx, ny);
    lastMoveDir = { dx, dy };
    addSandTrail(playerPos.x, playerPos.y, dx, dy);
    moved = true;
  } else if (isPushable(ahead)) {
    // Push stone
    const nx2 = nx + dx;
    const ny2 = ny + dy;
    const beyond = cellAt(nx2, ny2);
    if (isWalkable(beyond)) {
      // Move stone
      const stoneWasOnGoal = ahead === T.STONE_ON_GOAL;
      const beyondIsGoal = beyond === T.GOAL;
      setCell(nx2, ny2, beyondIsGoal ? T.STONE_ON_GOAL : T.STONE);
      setCell(nx, ny, stoneWasOnGoal ? T.GOAL : T.FLOOR);
      movePlayer(nx, ny);
      lastMoveDir = { dx, dy };
      addSandTrail(playerPos.x, playerPos.y, dx, dy);
      addSandTrail(nx2, ny2, dx, dy);
      moved = true;

      // Check if stone landed on goal
      if (beyondIsGoal) {
        spawnGoalParticles(nx2, ny2);
        shakeDuration = 8;
        shakeIntensity = 2;
      }

      // Check win
      if (checkWin()) {
        completionAnimation = 0.001;
        setTimeout(handleLevelClear, 1200);
        return;
      }
    } else {
      // Can't push - revert undo snapshot
      history.pop();
      shakeDuration = 6; shakeIntensity = 3;
    }
  } else {
    history.pop();
    shakeDuration = 6; shakeIntensity = 3;
  }

  if (moved) {
    moveCount++;
    animTick++;
  }
}

function movePlayer(nx, ny) {
  const wasOnGoal = cellAt(playerPos.x, playerPos.y) === T.PLAYER_ON_GOAL;
  setCell(playerPos.x, playerPos.y, wasOnGoal ? T.GOAL : T.FLOOR);
  const destIsGoal = cellAt(nx, ny) === T.GOAL;
  setCell(nx, ny, destIsGoal ? T.PLAYER_ON_GOAL : T.PLAYER);
  playerPos = { x: nx, y: ny };
}

function undoMove() {
  if (history.length === 0) return;
  const snap = history.pop();
  grid = snap.grid.map(r => [...r]);
  playerPos = { ...snap.pos };
  moveCount = snap.moveCount;
  animTick++;
  shakeDuration = 4;
  shakeIntensity = 1;
}

function checkWin() {
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] === T.GOAL || grid[y][x] === T.PLAYER_ON_GOAL) return false;
    }
  }
  return true;
}

function handleLevelClear() {
  const key = levelKey(currentWorld, currentLevel);
  saveData.cleared[key] = true;
  if (!saveData.bestMoves[key] || moveCount < saveData.bestMoves[key]) {
    saveData.bestMoves[key] = moveCount;
  }
  savePersist();

  const wData = WORLDS[currentWorld];
  const isLastLevel = currentLevel === wData.levels.length - 1;
  const isLastWorld = currentWorld === WORLDS.length - 1;

  if (isLastWorld && isLastLevel) {
    screen = SCREENS.GAME_CLEAR;
  } else if (isLastLevel) {
    screen = SCREENS.WORLD_CLEAR;
  } else {
    screen = SCREENS.CLEAR;
  }
}

// ─── Sand trails ─────────────────────────────────────────────────────────────
function addSandTrail(x, y, dx, dy) {
  sandTrails.push({ x, y, dx, dy, age: 0, maxAge: 120 });
  if (sandTrails.length > 80) sandTrails.splice(0, sandTrails.length - 80);
}

function updateSandTrails() {
  for (let i = sandTrails.length - 1; i >= 0; i--) {
    sandTrails[i].age++;
    if (sandTrails[i].age > sandTrails[i].maxAge) {
      sandTrails.splice(i, 1);
    }
  }
}

// ─── Particles ───────────────────────────────────────────────────────────────
function spawnGoalParticles(gx, gy) {
  const world = WORLDS[currentWorld];
  const col = world.color.goal;
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12 + Math.random() * 0.4;
    const speed = 1.5 + Math.random() * 2;
    particles.push({
      x: gx, y: gy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      decay: 0.03 + Math.random() * 0.02,
      color: col,
      size: 3 + Math.random() * 4,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * 0.6;
    p.y += p.vy * 0.6;
    p.vy += 0.08;
    p.life -= p.decay;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ─── Grid offset (center in canvas) ─────────────────────────────────────────
function getGridOffset() {
  if (grid.length === 0) return { ox: 0, oy: 0 };
  const rows = grid.length;
  const cols = Math.max(...grid.map(r => r.length));
  const tileScale = Math.min(
    (W * 0.85) / (cols * TILE),
    (H * 0.75) / (rows * TILE)
  );
  const ts = Math.min(tileScale, 1.0);
  const tw = TILE * ts;
  const th = TILE * ts;
  const totalW = cols * tw;
  const totalH = rows * th;
  const ox = (W - totalW) / 2;
  const oy = (H - totalH) / 2 + H * 0.04;
  return { ox, oy, ts, tw, th };
}

// ─── Drawing ─────────────────────────────────────────────────────────────────

function drawBackground(color) {
  ctx.fillStyle = color.bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle dot pattern
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = color.wall;
  const step = Math.floor(W / 40);
  for (let x = step; x < W; x += step * 2) {
    for (let y = step; y < H; y += step * 2) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTitleScreen() {
  // Animated background
  ctx.fillStyle = '#1a1a18';
  ctx.fillRect(0, 0, W, H);

  // Draw animated sand ripples
  ctx.save();
  const t = Date.now() / 1000;
  for (let i = 0; i < 5; i++) {
    const r = 60 + i * 55 + Math.sin(t * 0.5 + i) * 10;
    const alpha = 0.06 - i * 0.01;
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2 + 30, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(200,185,150,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  // Japanese title - 石庭
  const titleY = H * 0.32 + Math.sin(t * 0.8) * 3;
  ctx.save();
  ctx.textAlign = 'center';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.font = `bold ${Math.floor(W * 0.13)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillText('石庭', W / 2 + 3, titleY + 3);

  // Main title
  const titleGrad = ctx.createLinearGradient(W / 2 - 80, titleY - 70, W / 2 + 80, titleY);
  titleGrad.addColorStop(0, '#e8dfc8');
  titleGrad.addColorStop(0.5, '#fffae8');
  titleGrad.addColorStop(1, '#c8b890');
  ctx.fillStyle = titleGrad;
  ctx.font = `bold ${Math.floor(W * 0.13)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillText('石庭', W / 2, titleY);

  // Subtitle
  ctx.font = `${Math.floor(W * 0.03)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = '#998877';
  ctx.fillText('S T O N E   G A R D E N', W / 2, titleY + Math.floor(W * 0.05));
  ctx.restore();

  // Menu items
  const menuItems = ['ゲームを始める', 'つづきから', 'あそびかた'];
  const menuY = H * 0.62;
  const menuSpacing = H * 0.09;

  for (let i = 0; i < menuItems.length; i++) {
    const y = menuY + i * menuSpacing;
    const selected = (i === titleCursor);
    ctx.save();
    ctx.textAlign = 'center';

    if (selected) {
      // Selection background
      const bw = W * 0.3, bh = menuSpacing * 0.65;
      ctx.fillStyle = 'rgba(200,185,150,0.15)';
      roundRect(ctx, W / 2 - bw / 2, y - bh * 0.75, bw, bh, 4);
      ctx.fill();

      // Selection dots
      ctx.fillStyle = '#c8b890';
      ctx.font = `${Math.floor(W * 0.025)}px serif`;
      ctx.fillText('◆', W / 2 - W * 0.17, y - 2);
      ctx.fillText('◆', W / 2 + W * 0.17, y - 2);
    }

    ctx.font = `${Math.floor(W * 0.032)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
    ctx.fillStyle = selected ? '#ffe8a0' : '#998877';
    ctx.fillText(menuItems[i], W / 2, y);
    ctx.restore();
  }

  // Bottom hint
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(W * 0.018)}px 'Hiragino Mincho ProN',serif`;
  ctx.fillStyle = 'rgba(150,140,120,0.6)';
  ctx.fillText('↑↓ 選択  /  Enter・Space・クリックで決定', W / 2, H * 0.94);
  ctx.restore();
}

function drawWorldSelectScreen() {
  drawBackground({ bg: '#1a1a18', wall: '#333', floor: '#222', goal: '#556', sand: '#222' });

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(W * 0.04)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = '#c8b890';
  ctx.fillText('章を選ぶ', W / 2, H * 0.1);
  ctx.restore();

  const cols = 3;
  const rows = Math.ceil(WORLDS.length / cols);
  const cardW = W * 0.27;
  const cardH = H * 0.28;
  const padX = (W - cols * cardW) / (cols + 1);
  const padY = (H * 0.82 - rows * cardH) / (rows + 1);

  for (let i = 0; i < WORLDS.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = padX + col * (cardW + padX);
    const y = H * 0.14 + row * (cardH + padY);
    const unlocked = isWorldUnlocked(i);
    const selected = (i === currentWorld);
    const world = WORLDS[i];

    ctx.save();

    // Card BG
    ctx.fillStyle = unlocked
      ? (selected ? world.color.bg : '#242420')
      : '#1a1a18';
    roundRect(ctx, x, y, cardW, cardH, 8);
    ctx.fill();

    // Border
    ctx.strokeStyle = unlocked
      ? (selected ? world.color.goal : world.color.wall)
      : '#333';
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.stroke();

    if (unlocked) {
      // World number
      ctx.textAlign = 'left';
      ctx.font = `${Math.floor(cardW * 0.12)}px serif`;
      ctx.fillStyle = world.color.goal;
      ctx.fillText(`第${i + 1}章`, x + cardW * 0.08, y + cardH * 0.32);

      // World name
      ctx.textAlign = 'center';
      ctx.font = `${Math.floor(cardW * 0.14)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
      ctx.fillStyle = selected ? world.color.wall : '#c8b890';
      ctx.fillText(world.subtitle, x + cardW / 2, y + cardH * 0.6);

      ctx.font = `${Math.floor(cardW * 0.1)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
      ctx.fillStyle = selected ? world.color.wall : '#776655';
      ctx.fillText(world.name.split('—')[1]?.trim() || world.name, x + cardW / 2, y + cardH * 0.78);

      // Progress
      const cleared = world.levels.filter((_, li) => isCleared(i, li)).length;
      ctx.font = `${Math.floor(cardW * 0.09)}px monospace`;
      ctx.fillStyle = '#777';
      ctx.fillText(`${cleared}/${world.levels.length}`, x + cardW / 2, y + cardH * 0.92);
    } else {
      ctx.textAlign = 'center';
      ctx.font = `${Math.floor(cardW * 0.18)}px serif`;
      ctx.fillStyle = '#444';
      ctx.fillText('鍵', x + cardW / 2, y + cardH * 0.58);
    }

    ctx.restore();
  }

  // Controls hint
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(W * 0.018)}px serif`;
  ctx.fillStyle = 'rgba(150,140,120,0.6)';
  ctx.fillText('矢印キーで選択 / Enter で決定 / Esc でタイトルへ', W / 2, H * 0.96);
  ctx.restore();
}

function drawLevelSelectScreen() {
  const world = WORLDS[currentWorld];
  drawBackground(world.color);

  // World title
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(W * 0.05)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = world.color.wall;
  ctx.fillText(world.name, W / 2, H * 0.1);
  ctx.restore();

  const cols = 5;
  const levels = world.levels;
  const cardW = W * 0.15;
  const cardH = H * 0.22;
  const totalW = cols * cardW + (cols - 1) * cardW * 0.15;
  const startX = (W - totalW) / 2;
  const startY = H * 0.2;
  const gapX = cardW * 1.15;

  for (let i = 0; i < levels.length; i++) {
    const x = startX + i * gapX;
    const y = startY;
    const unlocked = isLevelUnlocked(currentWorld, i);
    const cleared = isCleared(currentWorld, i);
    const selected = (i === currentLevel);

    ctx.save();

    // Card
    ctx.fillStyle = cleared ? world.color.goal + 'aa'
                  : unlocked ? world.color.floor
                  : '#ddd';
    roundRect(ctx, x, y, cardW, cardH, 6);
    ctx.fill();

    ctx.strokeStyle = selected ? world.color.wall : 'rgba(0,0,0,0.2)';
    ctx.lineWidth = selected ? 2.5 : 1;
    ctx.stroke();

    if (unlocked) {
      // Level number
      ctx.textAlign = 'center';
      ctx.font = `bold ${Math.floor(cardW * 0.3)}px serif`;
      ctx.fillStyle = cleared ? '#fff' : world.color.wall;
      ctx.fillText(i + 1, x + cardW / 2, y + cardH * 0.45);

      // Level name
      ctx.font = `${Math.floor(cardW * 0.14)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
      ctx.fillStyle = cleared ? 'rgba(255,255,255,0.9)' : world.color.wall;
      ctx.fillText(levels[i].title, x + cardW / 2, y + cardH * 0.7);

      if (cleared) {
        const best = saveData.bestMoves[levelKey(currentWorld, i)];
        ctx.font = `${Math.floor(cardW * 0.11)}px monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillText(`最少 ${best}手`, x + cardW / 2, y + cardH * 0.87);
      }
    } else {
      ctx.textAlign = 'center';
      ctx.font = `${Math.floor(cardW * 0.28)}px serif`;
      ctx.fillStyle = '#bbb';
      ctx.fillText('鍵', x + cardW / 2, y + cardH * 0.55);
    }

    ctx.restore();
  }

  // Selected level preview
  if (isLevelUnlocked(currentWorld, currentLevel)) {
    const lvl = levels[currentLevel];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `${Math.floor(W * 0.028)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
    ctx.fillStyle = world.color.wall;
    ctx.fillText(`「${lvl.title}」  目安 ${lvl.par}手`, W / 2, H * 0.6);
    ctx.restore();
  }

  // Controls hint
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(W * 0.018)}px serif`;
  ctx.fillStyle = 'rgba(100,90,80,0.7)';
  ctx.fillText('矢印で選択 / Enter で開始 / Esc でワールド選択へ', W / 2, H * 0.96);
  ctx.restore();
}

function drawGame() {
  const world = WORLDS[currentWorld];
  const color = world.color;

  drawBackground(color);

  // HUD
  drawHUD(color);

  const { ox, oy, ts, tw, th } = getGridOffset();

  // Shake effect
  let shakeX = 0, shakeY = 0;
  if (shakeDuration > 0) {
    shakeX = (Math.random() - 0.5) * shakeIntensity * ts;
    shakeY = (Math.random() - 0.5) * shakeIntensity * ts;
    shakeDuration--;
  }

  ctx.save();
  ctx.translate(shakeX, shakeY);

  // Draw sand trails
  for (const trail of sandTrails) {
    const alpha = 1 - trail.age / trail.maxAge;
    const cx = ox + trail.x * tw + tw / 2;
    const cy = oy + trail.y * th + th / 2;
    drawSandTrail(cx, cy, trail.dx, trail.dy, tw, th, alpha * 0.35, color);
  }

  // Draw grid
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const cell = grid[y][x];
      if (cell === T.VOID) continue;
      const px = ox + x * tw;
      const py = oy + y * th;
      drawCell(cell, px, py, tw, th, color);
    }
  }

  // Draw particles (in tile coords)
  for (const p of particles) {
    const px = ox + p.x * tw + tw / 2;
    const py = oy + p.y * th + th / 2;
    ctx.save();
    ctx.globalAlpha = p.life * 0.9;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(px + p.vx * 8, py + p.vy * 8, p.size * ts, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Completion overlay
  if (completionAnimation > 0) {
    const alpha = Math.min(completionAnimation * 2, 0.7);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = Math.min(completionAnimation * 3, 1);
    ctx.textAlign = 'center';
    ctx.font = `bold ${Math.floor(W * 0.06)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
    ctx.fillStyle = color.wall;
    ctx.fillText('解けました', W / 2, H / 2 - H * 0.04);

    ctx.font = `${Math.floor(W * 0.025)}px serif`;
    ctx.fillStyle = color.goal;
    ctx.fillText(`${moveCount} 手`, W / 2, H / 2 + H * 0.04);
    ctx.restore();
  }

  ctx.restore();
}

function drawHUD(color) {
  const world = WORLDS[currentWorld];
  const lvl = world.levels[currentLevel];
  const par = lvl.par;

  ctx.save();

  // Top bar background
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(0, 0, W, H * 0.08);

  // World / level name
  ctx.textAlign = 'left';
  ctx.font = `${Math.floor(W * 0.022)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = color.wall;
  ctx.fillText(`${world.name.split('—')[0]} ${currentLevel + 1}. ${lvl.title}`, W * 0.02, H * 0.055);

  // Move counter
  ctx.textAlign = 'center';
  ctx.font = `${Math.floor(W * 0.026)}px monospace`;
  const moveColor = moveCount <= par ? color.goal : '#cc6644';
  ctx.fillStyle = moveColor;
  ctx.fillText(`${moveCount}手`, W / 2, H * 0.055);

  // Par
  ctx.font = `${Math.floor(W * 0.018)}px monospace`;
  ctx.fillStyle = 'rgba(100,90,80,0.6)';
  ctx.fillText(`目安 ${par}手`, W / 2, H * 0.075);

  // Undo button hint
  ctx.textAlign = 'right';
  ctx.font = `${Math.floor(W * 0.017)}px serif`;
  ctx.fillStyle = 'rgba(100,90,80,0.7)';
  ctx.fillText('Z: 戻す   R: リセット   Esc: 選択', W * 0.98, H * 0.055);

  ctx.restore();
}

function drawCell(cell, px, py, tw, th, color) {
  ctx.save();

  if (cell === T.WALL) {
    // Wall
    const wallGrad = ctx.createLinearGradient(px, py, px + tw, py + th);
    wallGrad.addColorStop(0, adjustBrightness(color.wall, 20));
    wallGrad.addColorStop(1, color.wall);
    ctx.fillStyle = wallGrad;
    ctx.fillRect(px, py, tw, th);

    // Wall texture lines
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(px, py + th * 0.3);
    ctx.lineTo(px + tw, py + th * 0.3);
    ctx.moveTo(px, py + th * 0.7);
    ctx.lineTo(px + tw, py + th * 0.7);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Floor
  ctx.fillStyle = color.floor;
  ctx.fillRect(px, py, tw, th);

  // Subtle floor grain
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 0.5;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(px + tw * i / 4, py);
    ctx.lineTo(px + tw * i / 4, py + th);
    ctx.stroke();
  }

  if (cell === T.GOAL || cell === T.PLAYER_ON_GOAL || cell === T.STONE_ON_GOAL) {
    drawGoalMark(px + tw / 2, py + th / 2, tw * 0.34, color);
  }

  if (cell === T.STONE || cell === T.STONE_ON_GOAL) {
    drawStone(px + tw / 2, py + th / 2, tw * 0.38, color);
  }

  if (cell === T.PLAYER || cell === T.PLAYER_ON_GOAL) {
    drawPlayer(px + tw / 2, py + th / 2, tw * 0.28, color);
  }

  ctx.restore();
}

function drawGoalMark(cx, cy, r, color) {
  ctx.save();
  // Moss circle
  const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
  g.addColorStop(0, adjustBrightness(color.goal, 30));
  g.addColorStop(1, adjustBrightness(color.goal, -20));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Inner ring
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = r * 0.12;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawStone(cx, cy, r, color) {
  ctx.save();
  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.1, cy + r * 0.15, r * 1.0, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();

  // Stone body - irregular polygon for natural look
  const stoneGrad = ctx.createRadialGradient(cx - r * 0.25, cy - r * 0.25, 0, cx, cy, r * 1.1);
  stoneGrad.addColorStop(0, adjustBrightness(color.wall, 45));
  stoneGrad.addColorStop(0.5, adjustBrightness(color.wall, 20));
  stoneGrad.addColorStop(1, color.wall);
  ctx.fillStyle = stoneGrad;

  ctx.beginPath();
  // 8-point stone shape
  const pts = 8;
  for (let i = 0; i < pts; i++) {
    const angle = (Math.PI * 2 * i) / pts - Math.PI / 2;
    const jitter = [0.95, 1.05, 0.9, 1.0, 0.95, 1.05, 0.88, 1.02][i];
    const rx = cx + Math.cos(angle) * r * jitter;
    const ry = cy + Math.sin(angle) * r * 0.82 * jitter;
    i === 0 ? ctx.moveTo(rx, ry) : ctx.lineTo(rx, ry);
  }
  ctx.closePath();
  ctx.fill();

  // Highlight
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.2, cy - r * 0.2, r * 0.4, r * 0.25, -Math.PI / 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPlayer(cx, cy, r, color) {
  const t = Date.now() / 400;
  const breathe = Math.sin(t) * r * 0.05;
  const pr = r + breathe;

  ctx.save();

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.ellipse(cx + pr * 0.1, cy + pr * 0.6, pr * 0.8, pr * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body (monk/figure)
  const bodyGrad = ctx.createRadialGradient(cx - pr * 0.2, cy - pr * 0.2, 0, cx, cy, pr * 1.4);
  bodyGrad.addColorStop(0, '#e8d8b8');
  bodyGrad.addColorStop(0.6, '#c8a870');
  bodyGrad.addColorStop(1, '#a08040');
  ctx.fillStyle = bodyGrad;

  // Robe shape
  ctx.beginPath();
  ctx.arc(cx, cy - pr * 0.1, pr * 1.1, 0, Math.PI * 2);
  ctx.fill();

  // Head circle (smaller, lighter)
  ctx.fillStyle = '#f0e0c0';
  ctx.beginPath();
  ctx.arc(cx, cy - pr * 0.6, pr * 0.55, 0, Math.PI * 2);
  ctx.fill();

  // Dot eyes
  ctx.fillStyle = '#604020';
  ctx.beginPath();
  ctx.arc(cx - pr * 0.18, cy - pr * 0.65, pr * 0.1, 0, Math.PI * 2);
  ctx.arc(cx + pr * 0.18, cy - pr * 0.65, pr * 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawSandTrail(cx, cy, dx, dy, tw, th, alpha, color) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = adjustBrightness(color.sand, -15);
  ctx.lineWidth = tw * 0.08;

  // Draw wave lines perpendicular to movement
  const perpX = -dy, perpY = dx;
  for (let i = -2; i <= 2; i++) {
    const offset = i * tw * 0.1;
    const x1 = cx + perpX * tw * 0.35 + offset * dx;
    const y1 = cy + perpY * th * 0.35 + offset * dy;
    const x2 = cx - perpX * tw * 0.35 + offset * dx;
    const y2 = cy - perpY * th * 0.35 + offset * dy;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx + offset * dx, cy + offset * dy, x2, y2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawClearScreen() {
  const world = WORLDS[currentWorld];
  drawBackground(world.color);
  drawGame();

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';

  // Title
  ctx.font = `bold ${Math.floor(W * 0.065)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = '#ffe8a0';
  ctx.fillText('クリア！', W / 2, H * 0.35);

  // Move count
  ctx.font = `${Math.floor(W * 0.032)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = '#e8d0a0';
  ctx.fillText(`${moveCount} 手で解きました`, W / 2, H * 0.48);

  const best = saveData.bestMoves[levelKey(currentWorld, currentLevel)];
  const par = world.levels[currentLevel].par;
  if (moveCount <= par) {
    ctx.fillStyle = world.color.goal;
    ctx.fillText(`目安手数内！ 見事です`, W / 2, H * 0.57);
  }

  // Options
  ctx.font = `${Math.floor(W * 0.028)}px serif`;
  ctx.fillStyle = '#c8b890';
  ctx.fillText('Enter / Space: 次のステージ', W / 2, H * 0.7);
  ctx.fillStyle = '#998877';
  ctx.fillText('R: もう一度   /   Esc: ステージ選択', W / 2, H * 0.78);

  ctx.restore();
}

function drawWorldClearScreen() {
  const world = WORLDS[currentWorld];
  drawBackground(world.color);

  ctx.save();
  ctx.textAlign = 'center';

  ctx.font = `bold ${Math.floor(W * 0.075)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = world.color.wall;
  ctx.fillText('章クリア', W / 2, H * 0.35);

  ctx.font = `${Math.floor(W * 0.04)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = world.color.goal;
  ctx.fillText(world.name, W / 2, H * 0.5);

  if (currentWorld < WORLDS.length - 1) {
    ctx.font = `${Math.floor(W * 0.03)}px serif`;
    ctx.fillStyle = world.color.wall;
    ctx.fillText('次の章が解放されました', W / 2, H * 0.63);

    ctx.font = `${Math.floor(W * 0.025)}px serif`;
    ctx.fillStyle = '#998877';
    ctx.fillText('Enter: 次の章へ   /   Esc: タイトルへ', W / 2, H * 0.8);
  }

  ctx.restore();
}

function drawGameClearScreen() {
  ctx.fillStyle = '#0a0a08';
  ctx.fillRect(0, 0, W, H);

  const t = Date.now() / 1000;

  // Animated concentric circles
  ctx.save();
  for (let i = 0; i < 8; i++) {
    const r = 30 + i * 50 + ((t * 20) % 50);
    const alpha = 0.08 - (r / 500) * 0.06;
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(200,185,130,${alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.textAlign = 'center';

  ctx.font = `bold ${Math.floor(W * 0.1)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  const grad = ctx.createLinearGradient(W / 2 - 120, H * 0.3, W / 2 + 120, H * 0.42);
  grad.addColorStop(0, '#c8a850');
  grad.addColorStop(0.5, '#ffe8a0');
  grad.addColorStop(1, '#c8a850');
  ctx.fillStyle = grad;
  ctx.fillText('大悟', W / 2, H * 0.42);

  ctx.font = `${Math.floor(W * 0.03)}px 'Hiragino Mincho ProN','Yu Mincho',serif`;
  ctx.fillStyle = '#c8b890';
  ctx.fillText('すべての石庭を解き明かしました', W / 2, H * 0.56);

  ctx.font = `${Math.floor(W * 0.022)}px serif`;
  ctx.fillStyle = '#776655';
  ctx.fillText('全 30 ステージ 完全クリア', W / 2, H * 0.65);

  ctx.font = `${Math.floor(W * 0.025)}px serif`;
  ctx.fillStyle = '#c8b890';
  ctx.fillText('Enter: タイトルへ戻る', W / 2, H * 0.82);

  ctx.restore();
}

// ─── Utilities ───────────────────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function adjustBrightness(hex, amount) {
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  r = Math.min(255, Math.max(0, r + amount));
  g = Math.min(255, Math.max(0, g + amount));
  b = Math.min(255, Math.max(0, b + amount));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ─── Main draw loop ──────────────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, W, H);

  switch (screen) {
    case SCREENS.TITLE:         drawTitleScreen(); break;
    case SCREENS.WORLD_SELECT:  drawWorldSelectScreen(); break;
    case SCREENS.LEVEL_SELECT:  drawLevelSelectScreen(); break;
    case SCREENS.GAME:          drawGame(); break;
    case SCREENS.CLEAR:         drawClearScreen(); break;
    case SCREENS.WORLD_CLEAR:   drawWorldClearScreen(); break;
    case SCREENS.GAME_CLEAR:    drawGameClearScreen(); break;
  }

  updateSandTrails();
  updateParticles();

  if (completionAnimation > 0 && completionAnimation < 1) {
    completionAnimation = Math.min(1, completionAnimation + 0.018);
  }

  requestAnimationFrame(draw);
}

// ─── Input ───────────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  switch (screen) {
    case SCREENS.TITLE:
      handleTitleInput(e);
      break;
    case SCREENS.WORLD_SELECT:
      handleWorldSelectInput(e);
      break;
    case SCREENS.LEVEL_SELECT:
      handleLevelSelectInput(e);
      break;
    case SCREENS.GAME:
      handleGameInput(e);
      break;
    case SCREENS.CLEAR:
      handleClearInput(e);
      break;
    case SCREENS.WORLD_CLEAR:
      handleWorldClearInput(e);
      break;
    case SCREENS.GAME_CLEAR:
      handleGameClearInput(e);
      break;
  }
});

function handleTitleInput(e) {
  const menuLength = 3;
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowLeft':
      titleCursor = (titleCursor - 1 + menuLength) % menuLength;
      break;
    case 'ArrowDown':
    case 'ArrowRight':
      titleCursor = (titleCursor + 1) % menuLength;
      break;
    case 'Enter':
    case ' ':
      executeTitleMenu(titleCursor);
      break;
  }
}

function executeTitleMenu(idx) {
  switch (idx) {
    case 0: // New game
      currentWorld = 0; currentLevel = 0;
      screen = SCREENS.WORLD_SELECT;
      break;
    case 1: // Continue
      // Find last unlocked level
      let found = false;
      for (let w = WORLDS.length - 1; w >= 0; w--) {
        if (!isWorldUnlocked(w)) continue;
        for (let l = WORLDS[w].levels.length - 1; l >= 0; l--) {
          if (isLevelUnlocked(w, l)) {
            currentWorld = w; currentLevel = l;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      screen = SCREENS.WORLD_SELECT;
      break;
    case 2: // How to play
      screen = SCREENS.WORLD_SELECT; // placeholder
      break;
  }
}

function handleWorldSelectInput(e) {
  const cols = 3;
  switch (e.key) {
    case 'ArrowLeft':
      currentWorld = Math.max(0, currentWorld - 1);
      break;
    case 'ArrowRight':
      currentWorld = Math.min(WORLDS.length - 1, currentWorld + 1);
      break;
    case 'ArrowUp':
      currentWorld = Math.max(0, currentWorld - cols);
      break;
    case 'ArrowDown':
      currentWorld = Math.min(WORLDS.length - 1, currentWorld + cols);
      break;
    case 'Enter':
    case ' ':
      if (isWorldUnlocked(currentWorld)) {
        currentLevel = 0;
        screen = SCREENS.LEVEL_SELECT;
      }
      break;
    case 'Escape':
      screen = SCREENS.TITLE;
      break;
  }
}

function handleLevelSelectInput(e) {
  const levels = WORLDS[currentWorld].levels;
  switch (e.key) {
    case 'ArrowLeft':
      currentLevel = Math.max(0, currentLevel - 1);
      break;
    case 'ArrowRight':
      currentLevel = Math.min(levels.length - 1, currentLevel + 1);
      break;
    case 'Enter':
    case ' ':
      if (isLevelUnlocked(currentWorld, currentLevel)) {
        loadLevel(currentWorld, currentLevel);
        screen = SCREENS.GAME;
      }
      break;
    case 'Escape':
      screen = SCREENS.WORLD_SELECT;
      break;
  }
}

function handleGameInput(e) {
  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': tryMove(0, -1); break;
    case 'ArrowDown':  case 's': case 'S': tryMove(0, 1);  break;
    case 'ArrowLeft':  case 'a': case 'A': tryMove(-1, 0); break;
    case 'ArrowRight': case 'd': case 'D': tryMove(1, 0);  break;
    case 'z': case 'Z': undoMove(); break;
    case 'r': case 'R': loadLevel(currentWorld, currentLevel); break;
    case 'Escape': screen = SCREENS.LEVEL_SELECT; break;
  }
}

function handleClearInput(e) {
  switch (e.key) {
    case 'Enter':
    case ' ':
      nextLevel();
      break;
    case 'r': case 'R':
      loadLevel(currentWorld, currentLevel);
      screen = SCREENS.GAME;
      break;
    case 'Escape':
      screen = SCREENS.LEVEL_SELECT;
      break;
  }
}

function handleWorldClearInput(e) {
  switch (e.key) {
    case 'Enter':
    case ' ':
      if (currentWorld < WORLDS.length - 1) {
        currentWorld++;
        currentLevel = 0;
        screen = SCREENS.LEVEL_SELECT;
      }
      break;
    case 'Escape':
      screen = SCREENS.TITLE;
      break;
  }
}

function handleGameClearInput(e) {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
    screen = SCREENS.TITLE;
  }
}

function nextLevel() {
  const world = WORLDS[currentWorld];
  if (currentLevel < world.levels.length - 1) {
    currentLevel++;
    loadLevel(currentWorld, currentLevel);
    screen = SCREENS.GAME;
  }
}

// ─── Mouse / Touch input ─────────────────────────────────────────────────────
canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (W / rect.width);
  const my = (e.clientY - rect.top) * (H / rect.height);

  if (screen === SCREENS.TITLE) {
    // Check menu click
    const menuY = H * 0.62;
    const menuSpacing = H * 0.09;
    for (let i = 0; i < 3; i++) {
      const y = menuY + i * menuSpacing;
      if (my >= y - menuSpacing * 0.5 && my <= y + menuSpacing * 0.5) {
        titleCursor = i;
        executeTitleMenu(i);
        return;
      }
    }
  }

  if (screen === SCREENS.GAME) {
    // Directional click relative to player
    const { ox, oy, tw, th } = getGridOffset();
    const px = ox + playerPos.x * tw + tw / 2;
    const py = oy + playerPos.y * th + th / 2;
    const diffX = mx - px;
    const diffY = my - py;
    if (Math.abs(diffX) > Math.abs(diffY)) {
      tryMove(diffX > 0 ? 1 : -1, 0);
    } else {
      tryMove(0, diffY > 0 ? 1 : -1);
    }
    return;
  }

  if (screen === SCREENS.WORLD_SELECT) {
    const cols = 3;
    const cardW = W * 0.27;
    const cardH = H * 0.28;
    const padX = (W - cols * cardW) / (cols + 1);
    const padY = (H * 0.82 - Math.ceil(WORLDS.length / cols) * cardH) / (Math.ceil(WORLDS.length / cols) + 1);

    for (let i = 0; i < WORLDS.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = padX + col * (cardW + padX);
      const y = H * 0.14 + row * (cardH + padY);
      if (mx >= x && mx <= x + cardW && my >= y && my <= y + cardH) {
        currentWorld = i;
        if (isWorldUnlocked(i)) {
          currentLevel = 0;
          screen = SCREENS.LEVEL_SELECT;
        }
        return;
      }
    }
  }

  if (screen === SCREENS.LEVEL_SELECT) {
    const cols = 5;
    const levels = WORLDS[currentWorld].levels;
    const cardW = W * 0.15;
    const cardH = H * 0.22;
    const totalW = cols * cardW + (cols - 1) * cardW * 0.15;
    const startX = (W - totalW) / 2;
    const startY = H * 0.2;
    const gapX = cardW * 1.15;
    for (let i = 0; i < levels.length; i++) {
      const x = startX + i * gapX;
      const y = startY;
      if (mx >= x && mx <= x + cardW && my >= y && my <= y + cardH) {
        currentLevel = i;
        if (isLevelUnlocked(currentWorld, i)) {
          loadLevel(currentWorld, i);
          screen = SCREENS.GAME;
        }
        return;
      }
    }
  }
});

// Swipe support
let touchStart = null;
canvas.addEventListener('touchstart', e => {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (!touchStart) return;
  const rect = canvas.getBoundingClientRect();
  const ex = e.changedTouches[0].clientX;
  const ey = e.changedTouches[0].clientY;
  const dx = ex - touchStart.x;
  const dy = ey - touchStart.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (screen === SCREENS.GAME && dist > 20) {
    if (Math.abs(dx) > Math.abs(dy)) {
      tryMove(dx > 0 ? 1 : -1, 0);
    } else {
      tryMove(0, dy > 0 ? 1 : -1);
    }
  } else if (dist < 10) {
    // Tap = click
    const fakeClick = new MouseEvent('click', {
      clientX: e.changedTouches[0].clientX,
      clientY: e.changedTouches[0].clientY
    });
    canvas.dispatchEvent(fakeClick);
  }
  touchStart = null;
  e.preventDefault();
}, { passive: false });

// ─── Boot ────────────────────────────────────────────────────────────────────
draw();

})();
