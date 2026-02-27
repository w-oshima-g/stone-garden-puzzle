// Stone Garden - Sound Engine
// Procedural audio using Web Audio API (no external files needed)

const SoundEngine = (function () {
  'use strict';

  let ctx = null;
  let masterGain = null;
  let bgmGain = null;
  let bgmNodes = [];
  let bgmScheduler = null;
  let currentWorldIdx = 0;
  let initialized = false;

  // World-specific BGM: root frequency & character
  const WORLD_MOODS = [
    { root: 110.00, label: '序章' },   // A2  – 静寂
    { root: 130.81, label: '第一章' }, // C3  – 流れ
    { root: 146.83, label: '第二章' }, // D3  – 形
    { root: 110.00, label: '第三章' }, // A2  – 深淵（暗め）
    { root: 164.81, label: '第四章' }, // E3  – 風
    { root: 130.81, label: '終章' },   // C3  – 悟り
  ];

  // Pentatonic intervals (ratio from root): A minor pentatonic
  const PENTA_RATIOS = [1, 6 / 5, 4 / 3, 3 / 2, 9 / 5, 2, 12 / 5, 8 / 3, 3, 4];

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    if (initialized) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return; // browser doesn't support Web Audio
    }

    // Master output chain
    masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.45, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // Separate gain for BGM (so SFX can be louder relative to BGM)
    bgmGain = ctx.createGain();
    bgmGain.gain.setValueAtTime(0.55, ctx.currentTime);
    bgmGain.connect(masterGain);

    initialized = true;
    startBGM(0);
  }

  function isReady() {
    return initialized && ctx && ctx.state === 'running';
  }

  // ─── BGM ─────────────────────────────────────────────────────────────────────
  function stopBGM() {
    bgmNodes.forEach(n => { try { n.stop(0); } catch (_) {} });
    bgmNodes = [];
    if (bgmScheduler) { clearTimeout(bgmScheduler); bgmScheduler = null; }
  }

  function startBGM(worldIdx) {
    if (!isReady()) return;
    stopBGM();
    currentWorldIdx = worldIdx;

    const mood = WORLD_MOODS[Math.min(worldIdx, WORLD_MOODS.length - 1)];
    const root = mood.root;

    // Drone: root / fifth / octave – very soft sine waves with slow LFO
    const droneFreqs = [root, root * 1.5, root * 2, root * 3];
    const droneGains = [0.055, 0.035, 0.022, 0.010];

    droneFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);

      // Breathing LFO
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(0.06 + i * 0.025, ctx.currentTime);
      lfoGain.gain.setValueAtTime(droneGains[i] * 0.35, ctx.currentTime);
      lfo.connect(lfoGain);
      lfoGain.connect(gain.gain);
      lfo.start();
      bgmNodes.push(lfo);

      gain.gain.setValueAtTime(droneGains[i], ctx.currentTime);
      osc.connect(gain);
      gain.connect(bgmGain);
      osc.start();
      bgmNodes.push(osc);
    });

    // Kick off sparse melodic notes
    scheduleMelodicNote();
  }

  function scheduleMelodicNote() {
    if (!isReady()) return;
    const mood = WORLD_MOODS[Math.min(currentWorldIdx, WORLD_MOODS.length - 1)];
    const root = mood.root;

    // Pick a random pentatonic frequency (upper registers)
    const ratio = PENTA_RATIOS[Math.floor(Math.random() * PENTA_RATIOS.length)];
    const octave = Math.random() < 0.4 ? 4 : 2; // occasionally jump up an octave
    const freq = root * ratio * octave;
    const vol = 0.03 + Math.random() * 0.035;
    const dur = 1.8 + Math.random() * 2.5;

    playBellTone(freq, vol, dur, bgmGain);

    // Next note in 4–10 seconds
    const delay = 4000 + Math.random() * 6000;
    bgmScheduler = setTimeout(scheduleMelodicNote, delay);
  }

  // Bell-like tone: sine + detuned harmonic with natural decay
  function playBellTone(freq, vol, decay, destination) {
    if (!isReady()) return;
    const now = ctx.currentTime;

    [[freq, vol], [freq * 2.756, vol * 0.28], [freq * 5.404, vol * 0.08]].forEach(([f, g]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now);
      gain.gain.setValueAtTime(g, now);
      gain.gain.setTargetAtTime(0.0001, now + 0.04, decay * 0.38);
      osc.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(now + decay + 0.3);
    });
  }

  // ─── SFX ─────────────────────────────────────────────────────────────────────

  // Player footstep – very subtle tap
  function sfxStep() {
    if (!isReady()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(550, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.055);
    gain.gain.setValueAtTime(0.045, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  // Pushing a stone – low gravelly thud
  function sfxPush() {
    if (!isReady()) return;
    const now = ctx.currentTime;

    // Low sine sweep
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(55, now + 0.18);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.2);

    // Short noise burst (sand/gravel texture)
    const bufLen = Math.floor(ctx.sampleRate * 0.09);
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufLen, 2);
    }
    const src = ctx.createBufferSource();
    const nGain = ctx.createGain();
    src.buffer = buf;
    nGain.gain.setValueAtTime(0.09, now);
    nGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    src.connect(nGain);
    nGain.connect(masterGain);
    src.start(now);
  }

  // Stone placed on goal – clear bell chime
  function sfxGoal() {
    if (!isReady()) return;
    playBellTone(880, 0.18, 1.8, masterGain);
    // Add a higher shimmer
    setTimeout(() => {
      if (!isReady()) return;
      playBellTone(1318.5, 0.08, 1.2, masterGain);
    }, 80);
  }

  // Bumping into a wall – short dull thud
  function sfxBump() {
    if (!isReady()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(75, now);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  // Undo – short descending note
  function sfxUndo() {
    if (!isReady()) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.14);
    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  // Level clear – ascending pentatonic chime (4 notes)
  function sfxClear() {
    if (!isReady()) return;
    const notes = [659.25, 783.99, 880, 1318.5];
    notes.forEach((freq, i) => {
      setTimeout(() => {
        if (!isReady()) return;
        playBellTone(freq, 0.16 - i * 0.02, 1.5, masterGain);
      }, i * 180);
    });
  }

  // World/chapter clear – more elaborate melody
  function sfxWorldClear() {
    if (!isReady()) return;
    const notes = [523.25, 659.25, 783.99, 880, 1046.5, 1318.5];
    notes.forEach((freq, i) => {
      setTimeout(() => {
        if (!isReady()) return;
        playBellTone(freq, 0.18 - i * 0.015, 2.0, masterGain);
      }, i * 200);
    });
  }

  // Game complete – grand ascending run + sustained chord
  function sfxGameClear() {
    if (!isReady()) return;
    const run = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1318.5];
    run.forEach((freq, i) => {
      setTimeout(() => {
        if (!isReady()) return;
        playBellTone(freq, 0.20 - i * 0.01, 2.5, masterGain);
      }, i * 140);
    });
    // Sustained final chord
    const chordDelay = run.length * 140 + 200;
    setTimeout(() => {
      if (!isReady()) return;
      [440, 659.25, 880, 1318.5].forEach(f => playBellTone(f, 0.12, 4.0, masterGain));
    }, chordDelay);
  }

  // ─── Public API ──────────────────────────────────────────────────────────────
  return {
    init,
    startBGM,
    stopBGM,
    sfxStep,
    sfxPush,
    sfxGoal,
    sfxBump,
    sfxUndo,
    sfxClear,
    sfxWorldClear,
    sfxGameClear,
  };
})();
