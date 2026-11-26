import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { ThemeAccent } from '../types/attendance';

export interface LandingBackgroundHandle {
  beginCharge: (
    pointerId: number,
    clientX: number,
    clientY: number,
    pressure: number,
    pointerType: string,
  ) => void;
  updateCharge: (pointerId: number, clientX: number, clientY: number, pressure: number) => void;
  updateForce: (webkitForce: number) => void;
  releaseCharge: (pointerId: number) => number;
  cancelCharge: (pointerId: number) => void;
}

interface LandingBackgroundCanvasProps {
  themeAccent: ThemeAccent;
}

interface SignalTrace {
  active: boolean;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  speed: number;
  color: string;
  alpha: number;
  tailLength: number;
  stepsRemaining: number;
  junctionX: number;
  junctionY: number;
  junctionFlash: number;
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  pointCount: number;
}

interface NodeBreath {
  active: boolean;
  x: number;
  y: number;
  elapsed: number;
  duration: number;
  maxAlpha: number;
  color: string;
  emitsPing: boolean;
  pingEmitted: boolean;
}

interface DriftSpore {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  swayAmp: number;
  swaySpeed: number;
  phase: number;
  size: number;
  alpha: number;
  color: string;
}

interface AmbientPing {
  active: boolean;
  x: number;
  y: number;
  elapsed: number;
  duration: number;
  maxRadius: number;
  maxAlpha: number;
  color: string;
}

interface ScanSweep {
  active: boolean;
  horizontal: boolean;
  pos: number;
  speed: number;
  cooldown: number;
  color: string;
  alpha: number;
}

interface ActiveCharge {
  active: boolean;
  pointerId: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  rotAngle: number;
  col: number;
  row: number;
  holdMs: number;
  peakPressure: number;
  hasRealPressure: boolean;
  isForceActive: boolean;
  initialPressure: number;
  pointerType: string;
  color: string;
  secondaryColor: string;
  coordLabel: string;
}

interface ClickRipple {
  active: boolean;
  x: number;
  y: number;
  elapsed: number;
  duration: number;
  maxRadius: number;
  intensity: number;
  ringCount: number;
  strokeWidth: number;
  maxAlpha: number;
  color: string;
  secondaryColor: string;
  label: string;
  isContactPing: boolean;
}

interface GridSpark {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  elapsed: number;
  duration: number;
  size: number;
  alpha: number;
  color: string;
}

const GRID_STEP = 32;

// Fixed pre-allocated object pool capacities (strictly zero per-frame allocations)
const MAX_TRACES = 22;
const MAX_BREATHS = 24;
const MAX_SPORES = 36;
const MAX_AUTO_PINGS = 4;
const MAX_SWEEPS = 2;
const MAX_CHARGES = 2;
const MAX_RIPPLES = 10;
const MAX_SPARKS = 56;

const MAX_HOLD_CHARGE_MS = 1200;

// Adaptive thermal frame pacing:
// - 30 FPS ambient idle (24 FPS in thermal-save mode)
// - VSync-aligned 60 FPS (15.5ms gate) during active charging/ripples: zero skipped frames on 60Hz,
//   clean 2nd-refresh 60Hz lock on 120Hz macOS ProMotion without wasting 120Hz CPU cycles
const IDLE_FRAME_MS = 1000 / 30;
const THERMAL_IDLE_FRAME_MS = 1000 / 24;
const ACTIVE_FRAME_MS = 15.5;

const PALETTE_RGB: Record<string, readonly [number, number, number]> = {
  '#22d3ee': [34, 211, 238],
  '#22c55e': [34, 197, 94],
  '#f5b82e': [245, 184, 46],
  '#ef4444': [239, 68, 68],
};

function blendColorCss(fromHex: string, toHex: string, t: number): string {
  const f = PALETTE_RGB[fromHex] ?? PALETTE_RGB['#22d3ee'];
  const to = PALETTE_RGB[toHex] ?? PALETTE_RGB['#f5b82e'];
  const k = clamp(t, 0, 1);
  const r = Math.round(f[0] + (to[0] - f[0]) * k);
  const g = Math.round(f[1] + (to[1] - f[1]) * k);
  const b = Math.round(f[2] + (to[2] - f[2]) * k);
  return `rgb(${r},${g},${b})`;
}

const ACCENT_HEX: Record<ThemeAccent, string> = {
  cyan: '#22d3ee',
  gold: '#f5b82e',
  green: '#22c55e',
  red: '#ef4444',
};

const SPIRIT_PALETTE = ['#22d3ee', '#22c55e', '#f5b82e', '#ef4444'] as const;

const CARDINAL_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const OCT_SPARK_DIRS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.7071, 0.7071],
  [-0.7071, 0.7071],
  [0.7071, -0.7071],
  [-0.7071, -0.7071],
  [0.9239, 0.3827],
  [-0.9239, 0.3827],
  [0.9239, -0.3827],
  [-0.9239, -0.3827],
  [0.3827, 0.9239],
  [-0.3827, -0.9239],
];

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function pickPaletteColor(primaryHex: string, indexHint: number): string {
  if (indexHint % 3 === 0) return primaryHex;
  return SPIRIT_PALETTE[indexHint % SPIRIT_PALETTE.length];
}

function pickComplementaryColor(primaryColor: string, seed: number): string {
  for (let offset = 1; offset <= SPIRIT_PALETTE.length; offset += 1) {
    const candidate = SPIRIT_PALETTE[(seed + offset) % SPIRIT_PALETTE.length];
    if (candidate !== primaryColor) return candidate;
  }
  return '#22d3ee';
}

function formatHexCoord(col: number, row: number): string {
  const c = Math.max(0, col).toString(16).toUpperCase().padStart(2, '0');
  const r = Math.max(0, row).toString(16).toUpperCase().padStart(2, '0');
  return `0x${c}:0x${r}`;
}

function createTracePool(): SignalTrace[] {
  const pool: SignalTrace[] = [];
  for (let i = 0; i < MAX_TRACES; i += 1) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      dirX: 1,
      dirY: 0,
      speed: 48,
      color: '#22d3ee',
      alpha: 0.24,
      tailLength: 96,
      stepsRemaining: 4,
      junctionX: 0,
      junctionY: 0,
      junctionFlash: 0,
      p0x: 0,
      p0y: 0,
      p1x: 0,
      p1y: 0,
      p2x: 0,
      p2y: 0,
      pointCount: 1,
    });
  }
  return pool;
}

function createBreathPool(): NodeBreath[] {
  const pool: NodeBreath[] = [];
  for (let i = 0; i < MAX_BREATHS; i += 1) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      elapsed: 0,
      duration: 2800,
      maxAlpha: 0.45,
      color: '#22d3ee',
      emitsPing: false,
      pingEmitted: false,
    });
  }
  return pool;
}

function createSporePool(): DriftSpore[] {
  const pool: DriftSpore[] = [];
  for (let i = 0; i < MAX_SPORES; i += 1) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      vy: -12,
      swayAmp: 8,
      swaySpeed: 0.8,
      phase: 0,
      size: 1,
      alpha: 0.2,
      color: '#22d3ee',
    });
  }
  return pool;
}

function createAutoPingPool(): AmbientPing[] {
  const pool: AmbientPing[] = [];
  for (let i = 0; i < MAX_AUTO_PINGS; i += 1) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      elapsed: 0,
      duration: 1300,
      maxRadius: 56,
      maxAlpha: 0.24,
      color: '#22d3ee',
    });
  }
  return pool;
}

function createSweepPool(): ScanSweep[] {
  const pool: ScanSweep[] = [];
  for (let i = 0; i < MAX_SWEEPS; i += 1) {
    pool.push({
      active: false,
      horizontal: i === 0,
      pos: 0,
      speed: 75,
      cooldown: 1800 + i * 3400,
      color: '#22d3ee',
      alpha: 0.08,
    });
  }
  return pool;
}

function createChargePool(): ActiveCharge[] {
  const pool: ActiveCharge[] = [];
  for (let i = 0; i < MAX_CHARGES; i += 1) {
    pool.push({
      active: false,
      pointerId: -1,
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      rotAngle: 0,
      col: 0,
      row: 0,
      holdMs: 0,
      peakPressure: 0,
      hasRealPressure: false,
      isForceActive: false,
      initialPressure: 0.5,
      pointerType: 'mouse',
      color: '#22d3ee',
      secondaryColor: '#22c55e',
      coordLabel: '0x00:0x00',
    });
  }
  return pool;
}

function createRipplePool(): ClickRipple[] {
  const pool: ClickRipple[] = [];
  for (let i = 0; i < MAX_RIPPLES; i += 1) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      elapsed: 0,
      duration: 860,
      maxRadius: 224,
      intensity: 0.2,
      ringCount: 1,
      strokeWidth: 1.25,
      maxAlpha: 0.52,
      color: '#22d3ee',
      secondaryColor: '#22c55e',
      label: '0x00:0x00',
      isContactPing: false,
    });
  }
  return pool;
}

function createSparkPool(): GridSpark[] {
  const pool: GridSpark[] = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    pool.push({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      elapsed: 0,
      duration: 540,
      size: 3,
      alpha: 0.78,
      color: '#22d3ee',
    });
  }
  return pool;
}

function resetTrace(
  trace: SignalTrace,
  width: number,
  height: number,
  primaryHex: string,
  seed: number,
) {
  const cols = Math.max(4, Math.floor(width / GRID_STEP));
  const rows = Math.max(4, Math.floor(height / GRID_STEP));
  const col = Math.floor(Math.random() * cols);
  const row = Math.floor(Math.random() * rows);
  const startX = col * GRID_STEP;
  const startY = row * GRID_STEP;
  const [dirX, dirY] = CARDINAL_DIRS[Math.floor(Math.random() * CARDINAL_DIRS.length)];
  const isBrisk = seed % 3 === 0;

  trace.active = true;
  trace.x = startX;
  trace.y = startY;
  trace.dirX = dirX;
  trace.dirY = dirY;
  trace.speed = isBrisk ? 58 + Math.random() * 34 : 30 + Math.random() * 24;
  trace.color = pickPaletteColor(primaryHex, seed);
  trace.alpha = isBrisk ? 0.24 + Math.random() * 0.14 : 0.15 + Math.random() * 0.12;
  trace.tailLength = isBrisk
    ? 88 + Math.floor(Math.random() * 68)
    : 56 + Math.floor(Math.random() * 52);
  trace.stepsRemaining = 2 + Math.floor(Math.random() * 6);
  trace.junctionFlash = 0;
  trace.p0x = startX;
  trace.p0y = startY;
  trace.p1x = startX;
  trace.p1y = startY;
  trace.p2x = startX;
  trace.p2y = startY;
  trace.pointCount = 1;
}

function launchTraceFromNode(
  trace: SignalTrace,
  gx: number,
  gy: number,
  dirX: number,
  dirY: number,
  color: string,
  intensity: number,
) {
  trace.active = true;
  trace.x = gx;
  trace.y = gy;
  trace.dirX = dirX;
  trace.dirY = dirY;
  trace.speed = 86 + intensity * 44;
  trace.color = color;
  trace.alpha = Math.min(0.46, 0.28 + intensity * 0.16);
  trace.tailLength = 104 + Math.floor(intensity * 56);
  trace.stepsRemaining = 3 + Math.floor(Math.random() * 4);
  trace.junctionX = gx;
  trace.junctionY = gy;
  trace.junctionFlash = 1;
  trace.p0x = gx;
  trace.p0y = gy;
  trace.p1x = gx;
  trace.p1y = gy;
  trace.p2x = gx;
  trace.p2y = gy;
  trace.pointCount = 1;
}

function pushTraceCorner(trace: SignalTrace, cx: number, cy: number) {
  trace.p2x = trace.p1x;
  trace.p2y = trace.p1y;
  trace.p1x = trace.p0x;
  trace.p1y = trace.p0y;
  trace.p0x = cx;
  trace.p0y = cy;
  if (trace.pointCount < 3) {
    trace.pointCount += 1;
  }
}

function resetBreath(
  breath: NodeBreath,
  width: number,
  height: number,
  primaryHex: string,
  seed: number,
  staggerPhase: boolean,
) {
  const cols = Math.max(4, Math.floor(width / GRID_STEP));
  const rows = Math.max(4, Math.floor(height / GRID_STEP));
  const col = 1 + Math.floor(Math.random() * Math.max(1, cols - 1));
  const row = 1 + Math.floor(Math.random() * Math.max(1, rows - 1));

  breath.active = true;
  breath.x = col * GRID_STEP;
  breath.y = row * GRID_STEP;
  breath.duration = 2400 + Math.random() * 2600;
  breath.elapsed = staggerPhase ? Math.random() * breath.duration : 0;
  breath.maxAlpha = 0.26 + Math.random() * 0.28;
  breath.color = pickPaletteColor(primaryHex, seed);
  breath.emitsPing = seed % 5 === 0;
  breath.pingEmitted = staggerPhase && breath.elapsed > breath.duration * 0.45;
}

function resetSpore(
  spore: DriftSpore,
  width: number,
  height: number,
  primaryHex: string,
  seed: number,
  randomY: boolean,
) {
  const isForeground = seed % 3 === 0;
  spore.active = true;
  spore.x = Math.random() * width;
  spore.y = randomY ? Math.random() * height : height + 8 + Math.random() * 24;
  spore.vy = isForeground ? -(12 + Math.random() * 12) : -(6 + Math.random() * 8);
  spore.swayAmp = isForeground ? 10 + Math.random() * 12 : 5 + Math.random() * 7;
  spore.swaySpeed = 0.55 + Math.random() * 0.75;
  spore.phase = Math.random() * Math.PI * 2;
  spore.size = isForeground ? 2 : 1;
  spore.alpha = isForeground ? 0.2 + Math.random() * 0.14 : 0.12 + Math.random() * 0.11;
  spore.color = pickPaletteColor(primaryHex, seed);
}

function computeChargeNormalized(charge: ActiveCharge): number {
  const rawHold = clamp(charge.holdMs / MAX_HOLD_CHARGE_MS, 0, 1);
  // Ease-out ramp so short holds (~300ms) already feel meaningfully stronger than quick taps.
  const holdNorm = 1 - Math.pow(1 - rawHold, 1.75);
  const pressureNorm = charge.hasRealPressure ? clamp(charge.peakPressure, 0, 1) : 0;
  return clamp(Math.max(holdNorm, pressureNorm * 0.9) + pressureNorm * 0.25, 0, 1);
}

function drawOctagonPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) {
  const cut = radius * 0.38;
  ctx.beginPath();
  ctx.moveTo(cx - radius + cut, cy - radius);
  ctx.lineTo(cx + radius - cut, cy - radius);
  ctx.lineTo(cx + radius, cy - radius + cut);
  ctx.lineTo(cx + radius, cy + radius - cut);
  ctx.lineTo(cx + radius - cut, cy + radius);
  ctx.lineTo(cx - radius + cut, cy + radius);
  ctx.lineTo(cx - radius, cy + radius - cut);
  ctx.lineTo(cx - radius, cy - radius + cut);
  ctx.closePath();
}

/**
 * Lightweight, macOS-friendly 2D canvas background rendering 4 concurrent layered
 * digital-nature ambient effects alongside hold-duration & pressure-sensitive click
 * charging and multi-ring harmonic discharges.
 *
 * Performance & thermal safeguards:
 * - Zero external dependencies, zero WebGL, zero ctx.shadowBlur / CSS blur filters
 * - Strictly fixed pre-allocated object pools (zero GC pressure in animation loop)
 * - Hollow-ring lattice pruning skips interior cells on large max-charge shockwaves
 * - Adaptive frame pacing (30 FPS idle, 50 FPS during active interactions)
 * - Self-monitoring draw-time watchdog automatically trims density if frame cost spikes
 * - Retina DPR clamping (<= 1.5, or 1.0 above 1920px) + instant pause on hidden/blur
 */
export const LandingBackgroundCanvas = forwardRef<
  LandingBackgroundHandle,
  LandingBackgroundCanvasProps
>(function LandingBackgroundCanvas({ themeAccent }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const accentHexRef = useRef<string>(ACCENT_HEX[themeAccent]);

  const apiRef = useRef<LandingBackgroundHandle>({
    beginCharge: () => undefined,
    updateCharge: () => undefined,
    updateForce: () => undefined,
    releaseCharge: () => 0,
    cancelCharge: () => undefined,
  });

  useEffect(() => {
    accentHexRef.current = ACCENT_HEX[themeAccent];
  }, [themeAccent]);

  useImperativeHandle(
    ref,
    () => ({
      beginCharge(pointerId, clientX, clientY, pressure, pointerType) {
        apiRef.current.beginCharge(pointerId, clientX, clientY, pressure, pointerType);
      },
      updateCharge(pointerId, clientX, clientY, pressure) {
        apiRef.current.updateCharge(pointerId, clientX, clientY, pressure);
      },
      updateForce(webkitForce) {
        apiRef.current.updateForce(webkitForce);
      },
      releaseCharge(pointerId) {
        return apiRef.current.releaseCharge(pointerId);
      },
      cancelCharge(pointerId) {
        apiRef.current.cancelCharge(pointerId);
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const traces = createTracePool();
    const breaths = createBreathPool();
    const spores = createSporePool();
    const autoPings = createAutoPingPool();
    const sweeps = createSweepPool();
    const charges = createChargePool();
    const ripples = createRipplePool();
    const sparks = createSparkPool();

    const reducedMotionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let prefersReducedMotion = reducedMotionQuery?.matches ?? false;

    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;
    let canvasLeft = 0;
    let canvasTop = 0;
    let rafId = 0;
    let isRunning = false;
    let isPaused = document.hidden;
    let lastDrawTime = 0;
    let traceRecycleCursor = 0;
    let autoPingCursor = 0;
    let rippleCursor = 0;
    let sparkCursor = 0;
    let colorCounter = 0;
    let resizeTimer = 0;

    // Self-monitoring thermal frame-time watchdog (EMA of JS draw cost in ms)
    let emaDrawMs = 1.0;
    let thermalSaveMode = false;

    function getActiveTraceBudget(): number {
      const base = viewportWidth < 640 ? 12 : MAX_TRACES;
      return thermalSaveMode ? Math.max(8, Math.round(base * 0.6)) : base;
    }

    function getActiveBreathBudget(): number {
      const base = viewportWidth < 640 ? 12 : MAX_BREATHS;
      return thermalSaveMode ? Math.max(8, Math.round(base * 0.6)) : base;
    }

    function getActiveSporeBudget(): number {
      const base = viewportWidth < 640 ? 18 : MAX_SPORES;
      return thermalSaveMode ? Math.max(10, Math.round(base * 0.55)) : base;
    }

    function getActiveSweepBudget(): number {
      return viewportWidth < 640 || thermalSaveMode ? 1 : MAX_SWEEPS;
    }

    function configureCanvasSize() {
      viewportWidth = window.innerWidth;
      viewportHeight = window.innerHeight;
      const rawDpr = window.devicePixelRatio || 1;
      const clampedDpr = viewportWidth > 1920 ? 1 : Math.min(rawDpr, 1.5);

      canvas!.width = Math.max(1, Math.floor(viewportWidth * clampedDpr));
      canvas!.height = Math.max(1, Math.floor(viewportHeight * clampedDpr));
      canvas!.style.width = `${viewportWidth}px`;
      canvas!.style.height = `${viewportHeight}px`;

      ctx!.setTransform(clampedDpr, 0, 0, clampedDpr, 0, 0);
      const rect = canvas!.getBoundingClientRect();
      canvasLeft = rect.left;
      canvasTop = rect.top;
    }

    function initAmbientLayers() {
      const primary = accentHexRef.current;

      const traceBudget = getActiveTraceBudget();
      for (let i = 0; i < MAX_TRACES; i += 1) {
        if (i < traceBudget) {
          resetTrace(traces[i], viewportWidth, viewportHeight, primary, i);
        } else {
          traces[i].active = false;
        }
      }

      const breathBudget = getActiveBreathBudget();
      for (let i = 0; i < MAX_BREATHS; i += 1) {
        if (i < breathBudget) {
          resetBreath(breaths[i], viewportWidth, viewportHeight, primary, i, true);
        } else {
          breaths[i].active = false;
        }
      }

      const sporeBudget = getActiveSporeBudget();
      for (let i = 0; i < MAX_SPORES; i += 1) {
        if (i < sporeBudget) {
          resetSpore(spores[i], viewportWidth, viewportHeight, primary, i, true);
        } else {
          spores[i].active = false;
        }
      }

      for (let i = 0; i < MAX_SWEEPS; i += 1) {
        const sw = sweeps[i];
        sw.active = false;
        sw.horizontal = i === 0;
        sw.cooldown = 1600 + i * 3600;
        sw.color = pickPaletteColor(primary, i);
      }
    }

    function hasActiveInteractions(): boolean {
      for (let i = 0; i < MAX_CHARGES; i += 1) {
        if (charges[i].active) return true;
      }
      for (let i = 0; i < MAX_RIPPLES; i += 1) {
        if (ripples[i].active) return true;
      }
      for (let i = 0; i < MAX_SPARKS; i += 1) {
        if (sparks[i].active) return true;
      }
      return false;
    }

    function stopLoop() {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      isRunning = false;
    }

    function startLoop() {
      if (isRunning || isPaused) return;
      if (prefersReducedMotion && !hasActiveInteractions()) return;
      isRunning = true;
      lastDrawTime = performance.now();
      rafId = window.requestAnimationFrame(frame);
    }

    function mapClientToCanvas(clientX: number, clientY: number) {
      const rawX = clientX - canvasLeft;
      const rawY = clientY - canvasTop;
      const col = Math.round(rawX / GRID_STEP);
      const row = Math.round(rawY / GRID_STEP);
      return { rawX, rawY, col, row };
    }

    function spawnAutoPing(x: number, y: number, color: string) {
      const ping = autoPings[autoPingCursor];
      autoPingCursor = (autoPingCursor + 1) % MAX_AUTO_PINGS;
      ping.active = true;
      ping.x = x;
      ping.y = y;
      ping.elapsed = 0;
      ping.duration = 1150 + Math.random() * 450;
      ping.maxRadius = 42 + Math.random() * 34;
      ping.maxAlpha = 0.2 + Math.random() * 0.08;
      ping.color = color;
    }

    function spawnContactPing(gx: number, gy: number, color: string) {
      const r = ripples[rippleCursor];
      rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
      r.active = true;
      r.x = gx;
      r.y = gy;
      r.elapsed = 0;
      r.duration = 260;
      r.maxRadius = 54;
      r.intensity = 0;
      r.ringCount = 1;
      r.strokeWidth = 1.1;
      r.maxAlpha = 0.36;
      r.color = color;
      r.secondaryColor = color;
      r.label = '';
      r.isContactPing = true;
    }

    function spawnScaledDischarge(charge: ActiveCharge, normCharge: number) {
      const isCompact = viewportWidth < 640;
      const powerMult = 1 + normCharge * 1.4;

      const r = ripples[rippleCursor];
      rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;

      r.active = true;
      r.x = charge.x;
      r.y = charge.y;
      r.elapsed = 0;
      r.intensity = normCharge;
      r.duration = prefersReducedMotion
        ? 520 + normCharge * 340
        : 720 + normCharge * 1020;
      r.maxRadius = isCompact
        ? 128 + normCharge * 172
        : 168 + normCharge * 308;
      r.ringCount = prefersReducedMotion
        ? 1
        : normCharge >= 0.72
          ? 3
          : normCharge >= 0.32
            ? 2
            : 1;
      r.strokeWidth = 1.2 + normCharge * 1.15;
      r.maxAlpha = 0.48 + normCharge * 0.34;
      r.color = charge.color;
      r.secondaryColor = charge.secondaryColor;
      r.isContactPing = false;
      r.label =
        normCharge >= 0.25
          ? `${charge.coordLabel} // ${powerMult.toFixed(1)}x`
          : charge.coordLabel;

      if (!prefersReducedMotion) {
        const sparkCount =
          normCharge >= 0.75 ? 14 : normCharge >= 0.38 ? 8 : 4;
        const baseSpeed = 145 + normCharge * 165;
        const baseDur = 440 + normCharge * 420;

        for (let d = 0; d < sparkCount; d += 1) {
          const spark = sparks[sparkCursor];
          sparkCursor = (sparkCursor + 1) % MAX_SPARKS;
          const [dx, dy] = OCT_SPARK_DIRS[d % OCT_SPARK_DIRS.length];
          const jitter = 0.86 + (d % 3) * 0.14;
          spark.active = true;
          spark.x = charge.x;
          spark.y = charge.y;
          spark.vx = dx * baseSpeed * jitter;
          spark.vy = dy * baseSpeed * jitter;
          spark.elapsed = 0;
          spark.duration = baseDur * (0.85 + (d % 2) * 0.22);
          spark.size = normCharge >= 0.7 && d < 4 ? 4 : 3;
          spark.alpha = 0.72 + normCharge * 0.24;
          spark.color = d % 3 === 2 ? charge.secondaryColor : charge.color;
        }

        // High-intensity releases also inject fresh signal traces directly into the ambient network.
        if (normCharge >= 0.62) {
          const launchCount = normCharge >= 0.88 ? 3 : 2;
          const budget = getActiveTraceBudget();
          const snappedX = Math.round(charge.x / GRID_STEP) * GRID_STEP;
          const snappedY = Math.round(charge.y / GRID_STEP) * GRID_STEP;
          for (let l = 0; l < launchCount; l += 1) {
            const slotIdx = traceRecycleCursor % Math.max(1, budget);
            traceRecycleCursor += 1;
            const [dirX, dirY] = CARDINAL_DIRS[(colorCounter + l) % CARDINAL_DIRS.length];
            launchTraceFromNode(
              traces[slotIdx],
              snappedX,
              snappedY,
              dirX,
              dirY,
              l === 0 ? charge.color : charge.secondaryColor,
              normCharge,
            );
          }
        }
      }
    }

    function beginCharge(
      pointerId: number,
      clientX: number,
      clientY: number,
      pressure: number,
      pointerType: string,
    ) {
      const { rawX, rawY, col, row } = mapClientToCanvas(clientX, clientY);

      // Find an existing slot for this pointerId or an inactive slot (fallback to slot 0).
      let slot = charges[0];
      for (let i = 0; i < MAX_CHARGES; i += 1) {
        if (charges[i].active && charges[i].pointerId === pointerId) {
          slot = charges[i];
          break;
        }
        if (!charges[i].active) {
          slot = charges[i];
          break;
        }
      }

      const color = pickPaletteColor(accentHexRef.current, colorCounter);
      const secondaryColor = pickComplementaryColor(color, colorCounter);
      colorCounter += 1;

      const isPen = pointerType === 'pen';
      const hasImmediatePressure =
        isPen || (pressure > 0 && Math.abs(pressure - 0.5) > 0.02 && pressure < 0.99);

      slot.active = true;
      slot.pointerId = pointerId;
      slot.x = rawX;
      slot.y = rawY;
      slot.targetX = rawX;
      slot.targetY = rawY;
      slot.rotAngle = 0;
      slot.col = col;
      slot.row = row;
      slot.holdMs = 0;
      slot.initialPressure = pressure;
      slot.pointerType = pointerType;
      slot.hasRealPressure = hasImmediatePressure;
      slot.isForceActive = false;
      slot.peakPressure = hasImmediatePressure ? clamp(pressure, 0, 1) : 0;
      slot.color = color;
      slot.secondaryColor = secondaryColor;
      slot.coordLabel = formatHexCoord(col, row);

      // Immediate subtle contact ping at the exact cursor point for zero-latency responsiveness.
      spawnContactPing(rawX, rawY, color);
      startLoop();
    }

    function updateCharge(
      pointerId: number,
      clientX: number,
      clientY: number,
      pressure: number,
    ) {
      for (let i = 0; i < MAX_CHARGES; i += 1) {
        const c = charges[i];
        if (!c.active || c.pointerId !== pointerId) continue;

        const { rawX, rawY, col, row } = mapClientToCanvas(clientX, clientY);
        c.targetX = rawX;
        c.targetY = rawY;
        if (col !== c.col || row !== c.row) {
          c.col = col;
          c.row = row;
          c.coordLabel = formatHexCoord(col, row);
        }

        // Detect live variable pointer pressure (stylus or pressure-capable touch/trackpad).
        if (
          c.pointerType === 'pen' ||
          (pressure > 0 && Math.abs(pressure - c.initialPressure) > 0.03)
        ) {
          c.hasRealPressure = true;
          const norm = clamp(pressure, 0, 1);
          if (norm > c.peakPressure) {
            c.peakPressure = norm;
          }
        }
        break;
      }
    }

    function updateForce(webkitForce: number) {
      // Safari macOS Force Touch reports ~1.0 for normal click up to 2.0–3.0 for Force Click.
      const normalized = clamp((webkitForce - 1.0) / 1.25, 0, 1);
      for (let i = 0; i < MAX_CHARGES; i += 1) {
        const c = charges[i];
        if (!c.active) continue;
        c.hasRealPressure = true;
        c.isForceActive = webkitForce > 1.08;
        if (normalized > c.peakPressure) {
          c.peakPressure = normalized;
        }
      }
    }

    function releaseCharge(pointerId: number): number {
      for (let i = 0; i < MAX_CHARGES; i += 1) {
        const c = charges[i];
        if (!c.active || c.pointerId !== pointerId) continue;

        const normCharge = computeChargeNormalized(c);
        c.active = false;
        spawnScaledDischarge(c, normCharge);
        startLoop();
        return normCharge;
      }
      return 0;
    }

    function cancelCharge(pointerId: number) {
      for (let i = 0; i < MAX_CHARGES; i += 1) {
        const c = charges[i];
        if (c.active && (pointerId === -1 || c.pointerId === pointerId)) {
          c.active = false;
        }
      }
    }

    apiRef.current = {
      beginCharge,
      updateCharge,
      updateForce,
      releaseCharge,
      cancelCharge,
    };

    // Layer 4: Slow atmospheric horizon scan sweeps
    function updateAndDrawSweeps(dtMs: number) {
      const budget = getActiveSweepBudget();
      const primary = accentHexRef.current;
      const dtSec = dtMs / 1000;

      for (let i = 0; i < MAX_SWEEPS; i += 1) {
        const sw = sweeps[i];
        if (i >= budget) {
          sw.active = false;
          continue;
        }

        if (!sw.active) {
          sw.cooldown -= dtMs;
          if (sw.cooldown <= 0) {
            sw.active = true;
            sw.horizontal = i === 0 ? Math.random() < 0.65 : Math.random() < 0.35;
            sw.pos = -GRID_STEP;
            sw.speed = 64 + Math.random() * 44;
            sw.color = pickPaletteColor(primary, colorCounter + i);
            sw.alpha = 0.075 + Math.random() * 0.045;
          }
          continue;
        }

        sw.pos += sw.speed * dtSec;
        const limit = sw.horizontal ? viewportHeight + GRID_STEP : viewportWidth + GRID_STEP;
        if (sw.pos > limit) {
          sw.active = false;
          sw.cooldown = 3200 + Math.random() * 4200;
          continue;
        }

        const p = Math.round(sw.pos);
        ctx!.strokeStyle = sw.color;
        ctx!.lineWidth = 1;
        ctx!.globalAlpha = sw.alpha;
        ctx!.beginPath();
        if (sw.horizontal) {
          ctx!.moveTo(0, p + 0.5);
          ctx!.lineTo(viewportWidth, p + 0.5);
        } else {
          ctx!.moveTo(p + 0.5, 0);
          ctx!.lineTo(p + 0.5, viewportHeight);
        }
        ctx!.stroke();

        // Highlight grid intersections along the leading scan row/column like wind over a field.
        ctx!.fillStyle = sw.color;
        ctx!.globalAlpha = sw.alpha * 2.4;
        if (sw.horizontal) {
          const snappedRow = Math.round(sw.pos / GRID_STEP) * GRID_STEP;
          if (Math.abs(snappedRow - sw.pos) < 8) {
            for (let gx = GRID_STEP; gx < viewportWidth; gx += GRID_STEP * 2) {
              ctx!.fillRect(gx - 1, snappedRow - 1, 3, 3);
            }
          }
        } else {
          const snappedCol = Math.round(sw.pos / GRID_STEP) * GRID_STEP;
          if (Math.abs(snappedCol - sw.pos) < 8) {
            for (let gy = GRID_STEP; gy < viewportHeight; gy += GRID_STEP * 2) {
              ctx!.fillRect(snappedCol - 1, gy - 1, 3, 3);
            }
          }
        }
      }
    }

    // Layer 3: Atmospheric drifting voxel spores / wind motes
    function updateAndDrawSpores(dtSec: number) {
      const budget = getActiveSporeBudget();
      const primary = accentHexRef.current;

      for (let i = 0; i < MAX_SPORES; i += 1) {
        const sp = spores[i];
        if (i >= budget) {
          sp.active = false;
          continue;
        }
        if (!sp.active) {
          resetSpore(sp, viewportWidth, viewportHeight, primary, i, true);
        }

        sp.phase += sp.swaySpeed * dtSec;
        sp.y += sp.vy * dtSec;
        const drawX = sp.x + Math.sin(sp.phase) * sp.swayAmp;

        if (sp.y < -12) {
          resetSpore(sp, viewportWidth, viewportHeight, primary, i + colorCounter, false);
          continue;
        }

        // Gentle vertical edge fade so motes materialize and dissolve smoothly.
        const edgeFade =
          sp.y < 64
            ? clamp(sp.y / 64, 0, 1)
            : sp.y > viewportHeight - 64
              ? clamp((viewportHeight - sp.y) / 64, 0, 1)
              : 1;

        ctx!.fillStyle = sp.color;
        ctx!.globalAlpha = sp.alpha * edgeFade;
        ctx!.fillRect(Math.round(drawX), Math.round(sp.y), sp.size, sp.size);
      }
    }

    // Layer 2: Organic grid-node fireflies & autonomous micro-pings
    function updateAndDrawBreathsAndPings(dtMs: number) {
      const budget = getActiveBreathBudget();
      const primary = accentHexRef.current;

      for (let i = 0; i < MAX_BREATHS; i += 1) {
        const b = breaths[i];
        if (i >= budget) {
          b.active = false;
          continue;
        }
        if (!b.active) {
          resetBreath(b, viewportWidth, viewportHeight, primary, i, true);
        }

        b.elapsed += dtMs;
        if (b.elapsed >= b.duration) {
          resetBreath(b, viewportWidth, viewportHeight, primary, i + colorCounter, false);
          continue;
        }

        const progress = b.elapsed / b.duration;
        const envelope = Math.sin(progress * Math.PI);
        const alpha = envelope * b.maxAlpha;

        if (b.emitsPing && !b.pingEmitted && progress >= 0.48) {
          b.pingEmitted = true;
          spawnAutoPing(b.x, b.y, b.color);
        }

        if (alpha > 0.03) {
          ctx!.fillStyle = b.color;
          ctx!.globalAlpha = alpha;
          ctx!.fillRect(b.x - 1, b.y - 1, 3, 3);

          // Crisp micro-crosshair ticks emerge softly near peak luminescence.
          if (envelope > 0.55) {
            ctx!.globalAlpha = (envelope - 0.55) * b.maxAlpha * 0.9;
            ctx!.fillRect(b.x - 5, b.y, 11, 1);
            ctx!.fillRect(b.x, b.y - 5, 1, 11);
          }
        }
      }

      // Autonomous quiet micro-pings
      ctx!.lineWidth = 1;
      for (let i = 0; i < MAX_AUTO_PINGS; i += 1) {
        const p = autoPings[i];
        if (!p.active) continue;

        p.elapsed += dtMs;
        if (p.elapsed >= p.duration) {
          p.active = false;
          continue;
        }

        const progress = p.elapsed / p.duration;
        const eased = 1 - Math.pow(1 - progress, 2.2);
        const radius = 6 + eased * p.maxRadius;

        ctx!.strokeStyle = p.color;
        ctx!.globalAlpha = (1 - progress) * p.maxAlpha;
        drawOctagonPath(ctx!, p.x, p.y, radius);
        ctx!.stroke();
      }
    }

    // Layer 1: High-density orthogonal signal traces with turn junction ticks
    function updateAndDrawTraces(dtSec: number) {
      const budget = getActiveTraceBudget();
      const primary = accentHexRef.current;

      ctx!.lineWidth = 1;
      for (let i = 0; i < MAX_TRACES; i += 1) {
        const t = traces[i];
        if (i >= budget) {
          t.active = false;
          continue;
        }
        if (!t.active) {
          resetTrace(t, viewportWidth, viewportHeight, primary, i);
        }

        const prevX = t.x;
        const prevY = t.y;
        t.x += t.dirX * t.speed * dtSec;
        t.y += t.dirY * t.speed * dtSec;

        if (t.junctionFlash > 0) {
          t.junctionFlash = Math.max(0, t.junctionFlash - dtSec * 2.8);
        }

        const crossedGrid =
          (t.dirX !== 0 && Math.floor(prevX / GRID_STEP) !== Math.floor(t.x / GRID_STEP)) ||
          (t.dirY !== 0 && Math.floor(prevY / GRID_STEP) !== Math.floor(t.y / GRID_STEP));

        if (crossedGrid) {
          t.stepsRemaining -= 1;
          if (t.stepsRemaining <= 0) {
            const snapX = Math.round(t.x / GRID_STEP) * GRID_STEP;
            const snapY = Math.round(t.y / GRID_STEP) * GRID_STEP;
            t.x = snapX;
            t.y = snapY;
            pushTraceCorner(t, snapX, snapY);
            t.junctionX = snapX;
            t.junctionY = snapY;
            t.junctionFlash = 1;

            if (t.dirX !== 0) {
              t.dirX = 0;
              t.dirY = Math.random() < 0.5 ? 1 : -1;
            } else {
              t.dirX = Math.random() < 0.5 ? 1 : -1;
              t.dirY = 0;
            }
            t.stepsRemaining = 2 + Math.floor(Math.random() * 6);
          }
        }

        if (
          t.x < -GRID_STEP * 3 ||
          t.x > viewportWidth + GRID_STEP * 3 ||
          t.y < -GRID_STEP * 3 ||
          t.y > viewportHeight + GRID_STEP * 3
        ) {
          resetTrace(t, viewportWidth, viewportHeight, primary, i + colorCounter);
          continue;
        }

        ctx!.strokeStyle = t.color;
        ctx!.globalAlpha = t.alpha;
        ctx!.beginPath();
        ctx!.moveTo(t.x, t.y);

        let remaining = t.tailLength;
        let curX = t.x;
        let curY = t.y;

        for (let seg = 0; seg < t.pointCount && remaining > 0; seg += 1) {
          const px = seg === 0 ? t.p0x : seg === 1 ? t.p1x : t.p2x;
          const py = seg === 0 ? t.p0y : seg === 1 ? t.p1y : t.p2y;
          const dx = px - curX;
          const dy = py - curY;
          const segLen = Math.abs(dx) + Math.abs(dy);

          if (segLen <= remaining) {
            ctx!.lineTo(px, py);
            remaining -= segLen;
            curX = px;
            curY = py;
          } else if (segLen > 0) {
            const ratio = remaining / segLen;
            ctx!.lineTo(curX + dx * ratio, curY + dy * ratio);
            remaining = 0;
          }
        }
        ctx!.stroke();

        // Crisp 3x3 pixel head node.
        ctx!.fillStyle = t.color;
        ctx!.globalAlpha = Math.min(0.72, t.alpha * 2.2);
        ctx!.fillRect(Math.round(t.x) - 1, Math.round(t.y) - 1, 3, 3);

        // Brief junction handshake tick when turning 90°.
        if (t.junctionFlash > 0.05) {
          ctx!.globalAlpha = t.junctionFlash * 0.42;
          ctx!.fillRect(t.junctionX - 4, t.junctionY, 9, 1);
          ctx!.fillRect(t.junctionX, t.junctionY - 4, 1, 9);
        }
      }
    }

    // Smooth, Cohesive Game-Like Charging Reticle rendered while user holds click / applies pressure
    function updateAndDrawCharges(dtMs: number) {
      const dtSec = dtMs / 1000;
      // Frame-rate-independent exponential smoothing: snappy yet silky with zero 32px grid stutter.
      const followAlpha = prefersReducedMotion ? 1 : 1 - Math.exp(-dtSec * 30);

      ctx!.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
      ctx!.textAlign = 'center';

      for (let i = 0; i < MAX_CHARGES; i += 1) {
        const c = charges[i];
        if (!c.active) continue;

        c.holdMs = Math.min(MAX_HOLD_CHARGE_MS * 1.4, c.holdMs + dtMs);
        c.x += (c.targetX - c.x) * followAlpha;
        c.y += (c.targetY - c.y) * followAlpha;

        const norm = computeChargeNormalized(c);
        const powerMult = 1 + norm * 1.4;
        const isOvercharged = norm >= 0.96;

        if (!prefersReducedMotion) {
          c.rotAngle += dtSec * (0.55 + norm * 1.55);
        }

        // Smooth color ramp as charge approaches peak (no abrupt color snap).
        const colorBlend = norm > 0.72 ? (norm - 0.72) / 0.28 : 0;
        const activeColor =
          colorBlend > 0.01 ? blendColorCss(c.color, c.secondaryColor, colorBlend * 0.65) : c.color;

        const breathe = prefersReducedMotion ? 0 : Math.sin(c.holdMs * 0.014);
        const ringRadius = 20 + norm * 11 + (isOvercharged ? breathe * 1.1 : 0);
        // Outer lock-on arcs always converge cleanly outside the charge ring (6px..22px margin).
        const bracketRadius = 42 - norm * 5 + (isOvercharged ? breathe * 0.6 : 0);

        // 1. Subtle nearest-grid anchor dot connecting cursor smoothly to the background lattice.
        if (norm > 0.14) {
          const gx = c.col * GRID_STEP;
          const gy = c.row * GRID_STEP;
          ctx!.fillStyle = activeColor;
          ctx!.globalAlpha = norm * 0.32;
          ctx!.fillRect(gx - 2, gy - 2, 4, 4);
        }

        // 2. Soft concentric radial energy aura (zero shadowBlur, ultra-lightweight fill).
        ctx!.fillStyle = activeColor;
        ctx!.globalAlpha = 0.05 + norm * 0.11 + (isOvercharged ? breathe * 0.025 : 0);
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, ringRadius * (0.85 + norm * 0.12), 0, Math.PI * 2);
        ctx!.fill();

        ctx!.globalAlpha = 0.09 + norm * 0.16;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, ringRadius * 0.42, 0, Math.PI * 2);
        ctx!.fill();

        // 3. Harmonic overcharge ready-pulse when at max charge.
        if (isOvercharged && !prefersReducedMotion) {
          const pulsePhase = (c.holdMs % 720) / 720;
          const pulseR = bracketRadius + pulsePhase * 18;
          ctx!.strokeStyle = activeColor;
          ctx!.lineWidth = 1.25;
          ctx!.globalAlpha = (1 - pulsePhase) * 0.42;
          ctx!.beginPath();
          ctx!.arc(c.x, c.y, pulseR, 0, Math.PI * 2);
          ctx!.stroke();
        }

        // 4. Analytic inward-converging energy motes (6 radial streams, zero allocations).
        if (!prefersReducedMotion && norm > 0.08) {
          ctx!.strokeStyle = activeColor;
          ctx!.lineWidth = 1.2;
          ctx!.lineCap = 'round';
          const moteSpeed = 0.0014 + norm * 0.0016;
          for (let m = 0; m < 6; m += 1) {
            const phase = (c.holdMs * moteSpeed + m / 6) % 1;
            const angle = (m * Math.PI) / 3 + c.rotAngle * 0.45;
            const outerR = bracketRadius + 10;
            const innerR = ringRadius * 0.45;
            const headR = outerR - phase * (outerR - innerR);
            const tailR = Math.min(outerR, headR + 4 + norm * 5);
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            ctx!.globalAlpha = Math.sin(phase * Math.PI) * (0.28 + norm * 0.48);
            ctx!.beginPath();
            ctx!.moveTo(c.x + cosA * tailR, c.y + sinA * tailR);
            ctx!.lineTo(c.x + cosA * headR, c.y + sinA * headR);
            ctx!.stroke();
          }
        }

        // 5. Subtle full circular track ring for clear 0% -> 100% progress legibility.
        ctx!.strokeStyle = activeColor;
        ctx!.lineWidth = 1.4;
        ctx!.lineCap = 'butt';
        ctx!.globalAlpha = 0.2 + norm * 0.12;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, ringRadius, 0, Math.PI * 2);
        ctx!.stroke();

        // 6. Smooth circular charge arc with bright leading energy tip.
        const startAngle = -Math.PI / 2;
        const sweepAngle = Math.PI * 2 * Math.max(0.03, norm);
        const endAngle = startAngle + sweepAngle;

        ctx!.strokeStyle = activeColor;
        ctx!.lineWidth = 2.4 + norm * 0.9;
        ctx!.lineCap = 'round';
        ctx!.globalAlpha = 0.78 + norm * 0.22;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, ringRadius, startAngle, endAngle);
        ctx!.stroke();

        // Bright leading spark head at the arc tip.
        const tipX = c.x + Math.cos(endAngle) * ringRadius;
        const tipY = c.y + Math.sin(endAngle) * ringRadius;
        ctx!.fillStyle = '#f8fafc';
        ctx!.globalAlpha = 0.72 + norm * 0.28;
        ctx!.beginPath();
        ctx!.arc(tipX, tipY, 2 + norm * 0.8, 0, Math.PI * 2);
        ctx!.fill();

        // 7. Four rotating outer lock-on arcs + radial precision ticks (never overlap the ring).
        ctx!.strokeStyle = activeColor;
        ctx!.lineWidth = 1.4;
        ctx!.lineCap = 'round';
        ctx!.globalAlpha = 0.42 + norm * 0.46;
        const halfArcSpan = 0.24 + norm * 0.05;
        for (let q = 0; q < 4; q += 1) {
          const mid = c.rotAngle + (q * Math.PI) / 2 + Math.PI / 4;
          ctx!.beginPath();
          ctx!.arc(c.x, c.y, bracketRadius, mid - halfArcSpan, mid + halfArcSpan);
          ctx!.stroke();

          // Short outward precision tick at arc midpoint.
          const cosM = Math.cos(mid);
          const sinM = Math.sin(mid);
          ctx!.beginPath();
          ctx!.moveTo(c.x + cosM * bracketRadius, c.y + sinM * bracketRadius);
          ctx!.lineTo(c.x + cosM * (bracketRadius + 4), c.y + sinM * (bracketRadius + 4));
          ctx!.stroke();
        }

        // 8. Crisp center core + delicate cardinal micro-reticle hairlines.
        const coreR = 2.6 + norm * 2.2;
        ctx!.fillStyle = activeColor;
        ctx!.globalAlpha = 0.85 + norm * 0.15;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, coreR, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = '#f8fafc';
        ctx!.globalAlpha = 0.65 + norm * 0.35;
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, coreR * 0.42, 0, Math.PI * 2);
        ctx!.fill();

        const tickInner = coreR + 4;
        const tickOuter = tickInner + 4;
        ctx!.strokeStyle = activeColor;
        ctx!.lineWidth = 1;
        ctx!.globalAlpha = 0.45 + norm * 0.3;
        ctx!.beginPath();
        ctx!.moveTo(c.x - tickOuter, c.y);
        ctx!.lineTo(c.x - tickInner, c.y);
        ctx!.moveTo(c.x + tickInner, c.y);
        ctx!.lineTo(c.x + tickOuter, c.y);
        ctx!.moveTo(c.x, c.y - tickOuter);
        ctx!.lineTo(c.x, c.y - tickInner);
        ctx!.moveTo(c.x, c.y + tickInner);
        ctx!.lineTo(c.x, c.y + tickOuter);
        ctx!.stroke();

        // 9. Clean, non-overlapping HUD telemetry centered strictly outside the outer brackets.
        const pct = Math.round(norm * 100);
        const tag = isOvercharged
          ? `MAX ${powerMult.toFixed(1)}x`
          : c.isForceActive || (c.hasRealPressure && c.peakPressure > 0.2)
            ? `FORCE ${powerMult.toFixed(1)}x`
            : `CHG ${pct}%`;

        const clearance = bracketRadius + 14;
        const placeAbove = c.y + clearance + 16 > viewportHeight;
        const labelX = clamp(c.x, 48, viewportWidth - 48);
        const labelY = placeAbove ? c.y - clearance : c.y + clearance;

        ctx!.textBaseline = placeAbove ? 'bottom' : 'top';
        ctx!.fillStyle = isOvercharged ? '#f8fafc' : activeColor;
        ctx!.globalAlpha = isOvercharged ? 0.94 : 0.84;
        ctx!.fillText(tag, labelX, labelY);
      }

      ctx!.lineCap = 'butt';
    }

    // Scaled Release Shockwaves with hollow-ring lattice illumination optimization
    function updateAndDrawRipples(dtMs: number) {
      ctx!.font = '600 10px "JetBrains Mono", ui-monospace, monospace';
      ctx!.textAlign = 'left';
      ctx!.textBaseline = 'bottom';

      for (let i = 0; i < MAX_RIPPLES; i += 1) {
        const r = ripples[i];
        if (!r.active) continue;

        r.elapsed += dtMs;
        if (r.elapsed >= r.duration) {
          r.active = false;
          continue;
        }

        const progress = r.elapsed / r.duration;
        const eased = 1 - Math.pow(1 - progress, 2.5);
        const fade = 1 - progress;
        const radius = eased * r.maxRadius;

        // 1. Primary smooth circular shockwave ring.
        ctx!.strokeStyle = r.color;
        ctx!.lineWidth = r.strokeWidth;
        ctx!.globalAlpha = fade * r.maxAlpha;
        ctx!.beginPath();
        ctx!.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx!.stroke();

        // 1b. Staggered harmonic echo rings for medium & high charge discharges.
        if (!r.isContactPing && r.ringCount >= 2 && progress > 0.08) {
          const p2 = clamp((progress - 0.08) / 0.92, 0, 1);
          const r2 = (1 - Math.pow(1 - p2, 2.4)) * r.maxRadius * 0.82;
          ctx!.strokeStyle = r.secondaryColor;
          ctx!.lineWidth = Math.max(1, r.strokeWidth * 0.78);
          ctx!.globalAlpha = (1 - p2) * r.maxAlpha * 0.62;
          ctx!.beginPath();
          ctx!.arc(r.x, r.y, r2, 0, Math.PI * 2);
          ctx!.stroke();
        }

        if (!r.isContactPing && r.ringCount >= 3 && progress > 0.18) {
          const p3 = clamp((progress - 0.18) / 0.82, 0, 1);
          const r3 = (1 - Math.pow(1 - p3, 2.3)) * r.maxRadius * 0.62;
          ctx!.strokeStyle = r.color;
          ctx!.lineWidth = 1;
          ctx!.globalAlpha = (1 - p3) * r.maxAlpha * 0.48;
          ctx!.beginPath();
          ctx!.arc(r.x, r.y, r3, 0, Math.PI * 2);
          ctx!.stroke();
        }

        if (r.isContactPing) continue;

        // 2. Orthogonal axis scan lines scaling with charge intensity.
        const maxAxis = GRID_STEP * (4 + Math.round(r.intensity * 6));
        const axisSpan = Math.min(radius * 0.88, maxAxis);
        ctx!.strokeStyle = r.color;
        ctx!.globalAlpha = fade * (0.26 + r.intensity * 0.22);
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(r.x - axisSpan, r.y);
        ctx!.lineTo(r.x + axisSpan, r.y);
        ctx!.moveTo(r.x, r.y - axisSpan);
        ctx!.lineTo(r.x, r.y + axisSpan);
        ctx!.stroke();

        // 3. Perimeter-pruned quantized lattice illumination (skips interior solid area).
        if (!prefersReducedMotion) {
          const bandWidth = 24 + r.intensity * 18;
          const outerBound = radius + bandWidth;
          const innerBound = Math.max(0, radius - bandWidth);

          const minCol = Math.max(0, Math.floor((r.x - outerBound) / GRID_STEP));
          const maxCol = Math.min(
            Math.ceil(viewportWidth / GRID_STEP),
            Math.ceil((r.x + outerBound) / GRID_STEP),
          );
          const minRow = Math.max(0, Math.floor((r.y - outerBound) / GRID_STEP));
          const maxRow = Math.min(
            Math.ceil(viewportHeight / GRID_STEP),
            Math.ceil((r.y + outerBound) / GRID_STEP),
          );

          ctx!.fillStyle = r.color;
          const dotSize = r.intensity >= 0.7 ? 5 : 4;
          const halfDot = dotSize >> 1;

          for (let row = minRow; row <= maxRow; row += 1) {
            const gy = row * GRID_STEP;
            const dy = gy - r.y;
            const absDy = Math.abs(dy);
            const canSkipInterior = absDy < innerBound;
            const skipMinCol = canSkipInterior
              ? Math.floor((r.x - innerBound) / GRID_STEP) + 1
              : maxCol + 1;
            const skipMaxCol = canSkipInterior
              ? Math.ceil((r.x + innerBound) / GRID_STEP) - 1
              : minCol - 1;

            for (let col = minCol; col <= maxCol; col += 1) {
              if (col >= skipMinCol && col <= skipMaxCol) {
                col = skipMaxCol;
                continue;
              }
              const gx = col * GRID_STEP;
              const absDx = Math.abs(gx - r.x);
              const octDist = Math.max(absDx, absDy, (absDx + absDy) * 0.72);
              const delta = Math.abs(octDist - radius);
              if (delta < bandWidth) {
                const intensity = (1 - delta / bandWidth) * fade;
                ctx!.globalAlpha = intensity * (0.62 + r.intensity * 0.28);
                ctx!.fillRect(gx - halfDot, gy - halfDot, dotSize, dotSize);
              }
            }
          }
        }

        // 4. Center origin flash + coordinate/power telemetry label.
        ctx!.fillStyle = r.color;
        ctx!.globalAlpha = fade * (0.78 + r.intensity * 0.2);
        const centerSize = r.intensity >= 0.65 ? 7 : 6;
        const halfCenter = centerSize >> 1;
        ctx!.fillRect(r.x - halfCenter, r.y - halfCenter, centerSize, centerSize);

        if (r.label && fade > 0.08) {
          ctx!.globalAlpha = fade * (0.72 + r.intensity * 0.2);
          ctx!.fillText(r.label, r.x + 10, r.y - 8 - eased * (10 + r.intensity * 8));
        }
      }
    }

    function updateAndDrawSparks(dtMs: number) {
      const dtSec = dtMs / 1000;
      for (let i = 0; i < MAX_SPARKS; i += 1) {
        const s = sparks[i];
        if (!s.active) continue;

        s.elapsed += dtMs;
        if (s.elapsed >= s.duration) {
          s.active = false;
          continue;
        }

        const progress = s.elapsed / s.duration;
        const damping = 1 - progress * 0.65;
        s.x += s.vx * damping * dtSec;
        s.y += s.vy * damping * dtSec;

        const half = s.size >> 1;
        ctx!.fillStyle = s.color;
        ctx!.globalAlpha = (1 - progress) * s.alpha;
        ctx!.fillRect(Math.round(s.x) - half, Math.round(s.y) - half, s.size, s.size);
      }
    }

    function frame(now: number) {
      if (!isRunning || isPaused) {
        isRunning = false;
        return;
      }

      const activeInteraction = hasActiveInteractions();
      const idleInterval = thermalSaveMode ? THERMAL_IDLE_FRAME_MS : IDLE_FRAME_MS;
      const targetInterval = activeInteraction ? ACTIVE_FRAME_MS : idleInterval;
      const elapsed = now - lastDrawTime;

      if (elapsed >= targetInterval) {
        const drawStart = performance.now();
        const dtMs = Math.min(elapsed, 80);
        const dtSec = dtMs / 1000;
        lastDrawTime = now - (elapsed % targetInterval);

        ctx!.clearRect(0, 0, viewportWidth, viewportHeight);

        if (!prefersReducedMotion) {
          // 4 concurrent layered ambient effects (back-to-front depth ordering)
          updateAndDrawSweeps(dtMs);
          updateAndDrawSpores(dtSec);
          updateAndDrawBreathsAndPings(dtMs);
          updateAndDrawTraces(dtSec);
        }

        if (activeInteraction) {
          updateAndDrawRipples(dtMs);
          updateAndDrawSparks(dtMs);
          updateAndDrawCharges(dtMs);
        }

        ctx!.globalAlpha = 1;

        // Lightweight rolling draw-time watchdog to protect macOS thermals automatically.
        const drawCostMs = performance.now() - drawStart;
        emaDrawMs = emaDrawMs * 0.92 + drawCostMs * 0.08;
        if (!thermalSaveMode && emaDrawMs > 6.0) {
          thermalSaveMode = true;
        } else if (thermalSaveMode && emaDrawMs < 2.6) {
          thermalSaveMode = false;
        }

        if (prefersReducedMotion && !hasActiveInteractions()) {
          ctx!.clearRect(0, 0, viewportWidth, viewportHeight);
          stopLoop();
          return;
        }
      }

      rafId = window.requestAnimationFrame(frame);
    }

    function handleVisibilityChange() {
      isPaused = document.hidden;
      if (isPaused) {
        cancelCharge(-1);
        stopLoop();
      } else {
        startLoop();
      }
    }

    function handleWindowBlur() {
      isPaused = true;
      cancelCharge(-1);
      stopLoop();
    }

    function handleWindowFocus() {
      isPaused = document.hidden;
      if (!isPaused) {
        startLoop();
      }
    }

    function handleResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        configureCanvasSize();
        initAmbientLayers();
      }, 150);
    }

    function handleReducedMotionChange(event: MediaQueryListEvent) {
      prefersReducedMotion = event.matches;
      if (prefersReducedMotion) {
        ctx!.clearRect(0, 0, viewportWidth, viewportHeight);
        if (!hasActiveInteractions()) {
          stopLoop();
        }
      } else {
        startLoop();
      }
    }

    configureCanvasSize();
    initAmbientLayers();
    startLoop();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('resize', handleResize, { passive: true });
    reducedMotionQuery?.addEventListener('change', handleReducedMotionChange);

    return () => {
      stopLoop();
      window.clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('resize', handleResize);
      reducedMotionQuery?.removeEventListener('change', handleReducedMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-bg-canvas" aria-hidden="true" />;
});
