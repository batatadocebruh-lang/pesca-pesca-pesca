import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { execFile } from "child_process";
import { PNG } from "pngjs";
import { Hardware, KeyboardButton, getAllWindows, sleep } from "keysender";
import {
  ACTION_LABELS,
  ALL_HOTKEY_ACTIONS,
  DEFAULT_HOTKEYS,
  HotkeyAction,
  HotkeyConfig,
  HotkeyManager,
  getExternalConflictWarning,
  resolveActionName,
} from "./hotkeys";
import {
  DEFAULT_KEY_HOLD,
  MAX_PROFILES,
  MAX_TECLAS,
  MacroEngine,
  MacroKeyStep,
} from "./macros";

// ============================================================================
// CONFIGURAÇÃO CENTRALIZADA (COM PERSISTÊNCIA EM config.json)
// ============================================================================
const ROOT_DIR =
  path.basename(__dirname).toLowerCase() === "dist" ? path.resolve(__dirname, "..") : __dirname;
const CONFIG_FILE_PATH = path.resolve(ROOT_DIR, "config.json");

export const CONFIG = {
  window: {
    title: "Roblox",
  },
  // Região de Interesse (ROI): barra horizontal inferior do minigame (calibrada para 960x600 / 1440x900 e auto-ajustável)
  roi: {
    x: 158,
    y: 420,
    width: 643,
    height: 147,
  },
  // Tempos do ciclo de automação de pesca e duração de cada tecla/clique (em milissegundos)
  timings: {
    castHoldMs: 1100, // Tempo segurando o botão esquerdo no lançamento
    pollingIntervalMs: 35, // Intervalo de leitura da ROI (30-50ms)
    biteTimeoutMs: 12000, // Timeout de segurança (12s) caso a mordida falhe
    captureDurationMs: 2700, // 2.7s de cliques contínuos na fase de captura
    clickPressMs: 25, // Tempo com botão esquerdo pressionado por clique (~25ms = 20 CPS)
    clickReleaseMs: 25, // Tempo com botão esquerdo solto após cada clique (~25ms = 20 CPS)
    postCaptureDelayMs: 1500, // Espera após concluir os cliques de captura antes de trocar o slot
    keyPressMs: 100, // Tempo pressionando as teclas de atalho (1 e 3)
    slotSwitchDelayMs: 500, // Intervalo entre ativar a tecla 1 e a tecla 3
    postEquipDelayMs: 1200, // Espera após ativar a tecla 3 para a vara terminar de equipar
    cooldownMs: 4000, // Tempo de espera/coleta quando a troca de hotbar está desativada
  },
  // Teclas da Hotbar para garantir que a vara de pesca esteja equipada ao finalizar cada ciclo
  hotbar: {
    enabled: false,
    resetSlotKey: "1" as KeyboardButton,
    rodSlotKey: "3" as KeyboardButton,
  },
  // Configuração do Autoclicker na fase de captura da pesca
  autoclicker: {
    cps: 20,
  },
  // Configuração de Detecção Visual (Template Matching Multi-Escala em buffer BGRA)
  vision: {
    templatePath: path.resolve(ROOT_DIR, "peixe_alvo.png"),
    barFramePath: path.resolve(ROOT_DIR, "moldura_barra.png"),
    stopButtonPath: path.resolve(ROOT_DIR, "botao_parar.png"),
    testScreenshotPath: path.resolve(ROOT_DIR, "nova_interface.png"),
    legacyScreenshotPath: path.resolve(ROOT_DIR, "Captura de tela 2026-10-29 233138.png"),
    threshold: 0.78,
    useCardFrameFallback: true,
    scales: [0.667, 0.711, 0.75, 0.8, 0.88, 1.0, 1.16, 1.345],
    sampleStep: 4,
    coarseStep: 4,
  },
  // Atalhos Globais Unificados (gerenciados pelo HotkeyManager sem conflitos)
  hotkeys: { ...DEFAULT_HOTKEYS } as HotkeyConfig,
  // Estado persistido do motor de macros
  macro: {
    activeProfileIndex: 0,
  },
};

function loadSavedConfig(): void {
  if (!fs.existsSync(CONFIG_FILE_PATH)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf-8"));
    if (raw.roi) Object.assign(CONFIG.roi, raw.roi);
    if (raw.timings) Object.assign(CONFIG.timings, raw.timings);
    if (raw.hotbar) {
      if (typeof raw.hotbar.enabled === "boolean") {
        CONFIG.hotbar.enabled = raw.hotbar.enabled;
      }
      if (typeof raw.hotbar.resetSlotKey === "string" && raw.hotbar.resetSlotKey.trim()) {
        CONFIG.hotbar.resetSlotKey = raw.hotbar.resetSlotKey.trim() as KeyboardButton;
      }
      if (typeof raw.hotbar.rodSlotKey === "string" && raw.hotbar.rodSlotKey.trim()) {
        CONFIG.hotbar.rodSlotKey = raw.hotbar.rodSlotKey.trim() as KeyboardButton;
      }
    }
    if (raw.autoclicker) Object.assign(CONFIG.autoclicker, raw.autoclicker);
    if (raw.vision) {
      if (typeof raw.vision.threshold === "number") CONFIG.vision.threshold = raw.vision.threshold;
      if (typeof raw.vision.useCardFrameFallback === "boolean") {
        CONFIG.vision.useCardFrameFallback = raw.vision.useCardFrameFallback;
      }
    }
    if (raw.hotkeys && typeof raw.hotkeys === "object") {
      for (const action of ALL_HOTKEY_ACTIONS) {
        if (typeof raw.hotkeys[action] === "string" && raw.hotkeys[action].trim()) {
          CONFIG.hotkeys[action] = raw.hotkeys[action].trim();
        }
      }
    }
    if (raw.macro && typeof raw.macro.activeProfileIndex === "number") {
      const idx = Math.trunc(raw.macro.activeProfileIndex);
      if (idx >= 0 && idx < MAX_PROFILES) {
        CONFIG.macro.activeProfileIndex = idx;
      }
    }
  } catch (err) {
    console.warn("[AVISO] Não foi possível ler config.json, usando valores padrão.", err);
  }
}

function saveConfig(): void {
  const data = {
    roi: CONFIG.roi,
    timings: CONFIG.timings,
    hotbar: {
      enabled: CONFIG.hotbar.enabled,
      resetSlotKey: CONFIG.hotbar.resetSlotKey,
      rodSlotKey: CONFIG.hotbar.rodSlotKey,
    },
    autoclicker: CONFIG.autoclicker,
    vision: {
      threshold: CONFIG.vision.threshold,
      useCardFrameFallback: CONFIG.vision.useCardFrameFallback,
    },
    hotkeys: CONFIG.hotkeys,
    macro: {
      activeProfileIndex: CONFIG.macro.activeProfileIndex,
    },
  };
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(data, null, 2), "utf-8");
}

loadSavedConfig();

// ============================================================================
// ESTRUTURAS E FUNÇÕES DE TEMPLATE MATCHING MULTI-ESCALA (BGRA)
// ============================================================================
interface TemplateSample {
  dx: number;
  dy: number;
  b: number;
  g: number;
  r: number;
  contrast: number;
}

interface ScaledVariant {
  scale: number;
  width: number;
  height: number;
  samples: TemplateSample[];
}

interface PreparedTemplate {
  width: number;
  height: number;
  fullVariants: ScaledVariant[];
  frameVariants: ScaledVariant[];
  stopVariants: ScaledVariant[];
}

interface MatchResult {
  found: boolean;
  score: number;
  fullScore: number;
  frameScore: number;
  stopScore: number;
  mode: "peixe_exato" | "moldura_card" | "botao_parar" | "nenhum";
  x: number;
  y: number;
}

function resizePng(src: PNG, newW: number, newH: number): PNG {
  const dst = new PNG({ width: newW, height: newH });
  for (let y = 0; y < newH; y++) {
    const sy = (y / Math.max(1, newH - 1)) * (src.height - 1);
    const y0 = Math.floor(sy);
    const y1 = Math.min(src.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < newW; x++) {
      const sx = (x / Math.max(1, newW - 1)) * (src.width - 1);
      const x0 = Math.floor(sx);
      const x1 = Math.min(src.width - 1, x0 + 1);
      const fx = sx - x0;
      const di = (y * newW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v00 = src.data[(y0 * src.width + x0) * 4 + c];
        const v10 = src.data[(y0 * src.width + x1) * 4 + c];
        const v01 = src.data[(y1 * src.width + x0) * 4 + c];
        const v11 = src.data[(y1 * src.width + x1) * 4 + c];
        const v0 = v00 * (1 - fx) + v10 * fx;
        const v1 = v01 * (1 - fx) + v11 * fx;
        dst.data[di + c] = Math.round(v0 * (1 - fy) + v1 * fy);
      }
      dst.data[di + 3] = 255;
    }
  }
  return dst;
}

function buildScaledVariants(
  png: PNG,
  scales: number[],
  step: number,
  excludeBox?: { x0: number; x1: number; y0: number; y1: number }
): ScaledVariant[] {
  return scales.map((scale) => {
    const w = Math.max(16, Math.round(png.width * scale));
    const h = Math.max(16, Math.round(png.height * scale));
    const scaled = scale === 1 ? png : resizePng(png, w, h);
    const samples: TemplateSample[] = [];

    const startY = Math.floor(h * 0.08);
    const endY = Math.ceil(h * 0.92);
    const startX = Math.floor(w * 0.06);
    const endX = Math.ceil(w * 0.94);

    for (let y = startY; y < endY; y += step) {
      for (let x = startX; x < endX; x += step) {
        if (excludeBox) {
          const nx = x / w;
          const ny = y / h;
          if (nx >= excludeBox.x0 && nx <= excludeBox.x1 && ny >= excludeBox.y0 && ny <= excludeBox.y1) {
            continue;
          }
        }
        const idx = (y * w + x) * 4;
        if (scaled.data[idx + 3] <= 128) continue;

        const r = scaled.data[idx];
        const g = scaled.data[idx + 1];
        const b = scaled.data[idx + 2];
        const contrast = Math.abs(r - 140) + Math.abs(g - 110) + Math.abs(b - 190);
        samples.push({ dx: x, dy: y, b, g, r, contrast });
      }
    }

    samples.sort((a, b) => b.contrast - a.contrast);
    const darks = samples.filter((s) => s.r + s.g + s.b < 180);
    const brights = samples.filter((s) => s.r + s.g + s.b >= 180);
    const interleaved: TemplateSample[] = [];
    const maxLen = Math.max(darks.length, brights.length);
    for (let k = 0; k < maxLen; k++) {
      if (k < brights.length) interleaved.push(brights[k]);
      if (k < darks.length) interleaved.push(darks[k]);
    }

    return { scale, width: w, height: h, samples: interleaved };
  });
}

function loadTemplate(templatePath: string): PreparedTemplate {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Imagem de referência não encontrada em: ${templatePath}`);
  }

  const fishPng = PNG.sync.read(fs.readFileSync(templatePath));
  const scales = CONFIG.vision.scales;
  const step = Math.max(2, CONFIG.vision.sampleStep);

  const fullVariants = buildScaledVariants(fishPng, scales, step);

  let frameVariants: ScaledVariant[];
  if (fs.existsSync(CONFIG.vision.barFramePath)) {
    const barFramePng = PNG.sync.read(fs.readFileSync(CONFIG.vision.barFramePath));
    frameVariants = buildScaledVariants(barFramePng, scales, step + 1, {
      x0: 0.33,
      x1: 0.67,
      y0: 0.08,
      y1: 0.92,
    });
  } else {
    frameVariants = buildScaledVariants(fishPng, scales, step, {
      x0: 0.22,
      x1: 0.8,
      y0: 0.18,
      y1: 0.84,
    });
  }

  let stopVariants: ScaledVariant[] = [];
  if (fs.existsSync(CONFIG.vision.stopButtonPath)) {
    const stopPng = PNG.sync.read(fs.readFileSync(CONFIG.vision.stopButtonPath));
    stopVariants = buildScaledVariants(stopPng, scales, step);
  }

  return {
    width: fishPng.width,
    height: fishPng.height,
    fullVariants,
    frameVariants,
    stopVariants,
  };
}

function searchVariantsBGRA(
  roiBuffer: Buffer,
  roiWidth: number,
  roiHeight: number,
  variants: ScaledVariant[]
): { score: number; x: number; y: number } {
  const coarseStep = Math.max(1, CONFIG.vision.coarseStep);
  let best = { score: 0, x: -1, y: -1 };

  for (const v of variants) {
    const maxX = roiWidth - v.width;
    const maxY = roiHeight - v.height;
    if (maxX < 0 || maxY < 0 || v.samples.length === 0) continue;

    const numSamples = v.samples.length;
    const normDenom = numSamples * 380;
    let bestDiff = Infinity;
    let bestX = 0;
    let bestY = 0;

    const evaluateAt = (ox: number, oy: number, cutoffDiff: number): number => {
      let diff = 0;
      for (let i = 0; i < numSamples; i++) {
        const s = v.samples[i];
        const idx = ((oy + s.dy) * roiWidth + (ox + s.dx)) * 4;
        diff +=
          Math.abs(roiBuffer[idx] - s.b) +
          Math.abs(roiBuffer[idx + 1] - s.g) +
          Math.abs(roiBuffer[idx + 2] - s.r);

        if (diff >= cutoffDiff) {
          return diff;
        }
      }
      return diff;
    };

    for (let y = 0; y <= maxY; y += coarseStep) {
      for (let x = 0; x <= maxX; x += coarseStep) {
        const diff = evaluateAt(x, y, bestDiff);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestX = x;
          bestY = y;
        }
      }
    }

    if (coarseStep > 1) {
      const refineStartX = Math.max(0, bestX - coarseStep);
      const refineEndX = Math.min(maxX, bestX + coarseStep);
      const refineStartY = Math.max(0, bestY - coarseStep);
      const refineEndY = Math.min(maxY, bestY + coarseStep);

      for (let y = refineStartY; y <= refineEndY; y++) {
        for (let x = refineStartX; x <= refineEndX; x++) {
          const diff = evaluateAt(x, y, bestDiff);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestX = x;
            bestY = y;
          }
        }
      }
    }

    const score = Math.max(0, 1 - bestDiff / normDenom);
    if (score > best.score) {
      best = { score, x: bestX, y: bestY };
      if (best.score >= Math.max(0.85, CONFIG.vision.threshold + 0.05)) break;
    }
  }

  return best;
}

function matchTemplateBGRA(
  roiBuffer: Buffer,
  roiWidth: number,
  roiHeight: number,
  template: PreparedTemplate,
  threshold: number,
  computeAllScores = false
): MatchResult {
  const fullRes = searchVariantsBGRA(roiBuffer, roiWidth, roiHeight, template.fullVariants);

  if (!computeAllScores && fullRes.score >= threshold) {
    return {
      found: true,
      score: fullRes.score,
      fullScore: fullRes.score,
      frameScore: fullRes.score,
      stopScore: fullRes.score,
      mode: "peixe_exato",
      x: fullRes.x,
      y: fullRes.y,
    };
  }

  let frameRes = { score: 0, x: fullRes.x, y: fullRes.y };
  let stopRes = { score: 0, x: fullRes.x, y: fullRes.y };

  if (CONFIG.vision.useCardFrameFallback) {
    frameRes = searchVariantsBGRA(roiBuffer, roiWidth, roiHeight, template.frameVariants);
    if (!computeAllScores && frameRes.score >= threshold) {
      return {
        found: true,
        score: frameRes.score,
        fullScore: fullRes.score,
        frameScore: frameRes.score,
        stopScore: 0,
        mode: "moldura_card",
        x: frameRes.x,
        y: frameRes.y,
      };
    }

    if (template.stopVariants.length > 0) {
      stopRes = searchVariantsBGRA(roiBuffer, roiWidth, roiHeight, template.stopVariants);
    }
  }

  if (fullRes.score >= threshold && fullRes.score >= frameRes.score) {
    return {
      found: true,
      score: fullRes.score,
      fullScore: fullRes.score,
      frameScore: frameRes.score,
      stopScore: stopRes.score,
      mode: "peixe_exato",
      x: fullRes.x,
      y: fullRes.y,
    };
  }

  if (CONFIG.vision.useCardFrameFallback && frameRes.score >= threshold) {
    return {
      found: true,
      score: frameRes.score,
      fullScore: fullRes.score,
      frameScore: frameRes.score,
      stopScore: stopRes.score,
      mode: "moldura_card",
      x: frameRes.x,
      y: frameRes.y,
    };
  }

  if (CONFIG.vision.useCardFrameFallback && stopRes.score >= threshold) {
    return {
      found: true,
      score: stopRes.score,
      fullScore: fullRes.score,
      frameScore: frameRes.score,
      stopScore: stopRes.score,
      mode: "botao_parar",
      x: stopRes.x,
      y: stopRes.y,
    };
  }

  const bestScore = Math.max(fullRes.score, frameRes.score, stopRes.score);
  const bestPos =
    bestScore === fullRes.score ? fullRes : bestScore === frameRes.score ? frameRes : stopRes;

  return {
    found: false,
    score: bestScore,
    fullScore: fullRes.score,
    frameScore: frameRes.score,
    stopScore: stopRes.score,
    mode: "nenhum",
    x: bestPos.x,
    y: bestPos.y,
  };
}

function isBufferNonEmpty(buf: Buffer): boolean {
  const step = Math.max(4, Math.floor(buf.length / 200) * 4);
  for (let i = 0; i < buf.length - 4; i += step) {
    if (buf[i] !== 0 || buf[i + 1] !== 0 || buf[i + 2] !== 0) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// INICIALIZAÇÃO DE HARDWARE, VISÃO, HOTKEYS E MOTOR DE MACROS
// ============================================================================
const bot = new Hardware(CONFIG.window.title);
const screenBot = new Hardware();
const fishTemplate = loadTemplate(CONFIG.vision.templatePath);
const hotkeyManager = new HotkeyManager();

const conflictNotices = hotkeyManager.loadBindings(CONFIG.hotkeys);
if (conflictNotices.length > 0) {
  CONFIG.hotkeys = hotkeyManager.getConfigSnapshot();
  saveConfig();
}

const macroEngine = new MacroEngine({
  rootDir: ROOT_DIR,
  hardware: screenBot,
  hotkeyManager,
  initialProfileIndex: CONFIG.macro.activeProfileIndex,
  onProfileChange: (idx) => {
    CONFIG.macro.activeProfileIndex = idx;
    saveConfig();
  },
});

function autoCalibrateRoiForScreen(): void {
  try {
    const fullDesktop = screenBot.workwindow.capture("bgra");
    if (!fullDesktop || !fullDesktop.width || !fullDesktop.height) return;

    const sw = fullDesktop.width;
    const sh = fullDesktop.height;
    const expectedX = Math.round(sw * 0.165);
    const expectedY = Math.round(sh * 0.7);
    const expectedW = Math.round(sw * 0.67);
    const expectedH = Math.round(sh * 0.245);

    if (
      Math.abs(CONFIG.roi.x - expectedX) > 15 ||
      Math.abs(CONFIG.roi.y - expectedY) > 15 ||
      Math.abs(CONFIG.roi.width - expectedW) > 20 ||
      Math.abs(CONFIG.roi.height - expectedH) > 20
    ) {
      CONFIG.roi = { x: expectedX, y: expectedY, width: expectedW, height: expectedH };
      saveConfig();
      console.log(
        `[AUTO-ROI] Resolução detectada (${sw}x${sh}). ROI ajustada automaticamente para x=${CONFIG.roi.x}, y=${CONFIG.roi.y}, ${CONFIG.roi.width}x${CONFIG.roi.height}.`
      );
    }

    const targetScale = sh / 900;
    const sortByTargetScale = (a: ScaledVariant, b: ScaledVariant) =>
      Math.abs(a.scale - targetScale) - Math.abs(b.scale - targetScale);
    fishTemplate.fullVariants.sort(sortByTargetScale);
    fishTemplate.frameVariants.sort(sortByTargetScale);
    fishTemplate.stopVariants.sort(sortByTargetScale);
  } catch {
    // Mantém a ROI atual se não for possível consultar o desktop
  }
}

// ============================================================================
// ESTADO DE EXECUÇÃO E COORDENAÇÃO ENTRE PESCA E MACROS
// ============================================================================
let fishingRunning = false;
let loopActive = false;
let cliOnlyMode = false;
let inWizard = false;
let ignoreLinesUntil = 0;
let pendingLineResolver: ((line: string) => void) | null = null;

function ensureRobloxWindow(): boolean {
  if (bot.workwindow.isOpen()) {
    return true;
  }

  if (bot.workwindow.refresh()) {
    return true;
  }

  const robloxWin = getAllWindows().find(
    (w) =>
      w.title.toLowerCase().includes(CONFIG.window.title.toLowerCase()) ||
      w.className.toLowerCase().includes("roblox")
  );

  if (robloxWin) {
    bot.workwindow.set(robloxWin.handle);
    return bot.workwindow.isOpen();
  }

  return false;
}

function captureROI() {
  const deskCap = screenBot.workwindow.capture(CONFIG.roi, "bgra");
  if (deskCap && deskCap.data && isBufferNonEmpty(deskCap.data)) {
    return deskCap;
  }
  return bot.workwindow.capture(CONFIG.roi, "bgra");
}

function evaluatePngScreenshot(screenshotPath: string): boolean {
  if (!fs.existsSync(screenshotPath)) {
    console.log(`[TESTE] Arquivo de teste não encontrado: ${path.basename(screenshotPath)}`);
    return false;
  }

  const startMs = performance.now();
  const fullPng = PNG.sync.read(fs.readFileSync(screenshotPath));

  const isCroppedBar = fullPng.height < 400;
  const rx = isCroppedBar ? 0 : Math.round(fullPng.width * 0.165);
  const ry = isCroppedBar ? 0 : Math.round(fullPng.height * 0.7);
  const rw = isCroppedBar ? fullPng.width : Math.min(fullPng.width - rx, Math.round(fullPng.width * 0.67));
  const rh = isCroppedBar ? fullPng.height : Math.min(fullPng.height - ry, Math.round(fullPng.height * 0.245));

  const roiBgra = Buffer.alloc(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(fullPng.width - 1, rx + x);
      const sy = Math.min(fullPng.height - 1, ry + y);
      const srcIdx = (sy * fullPng.width + sx) * 4;
      const dstIdx = (y * rw + x) * 4;
      roiBgra[dstIdx] = fullPng.data[srcIdx + 2];
      roiBgra[dstIdx + 1] = fullPng.data[srcIdx + 1];
      roiBgra[dstIdx + 2] = fullPng.data[srcIdx];
      roiBgra[dstIdx + 3] = 0;
    }
  }

  const result = matchTemplateBGRA(roiBgra, rw, rh, fishTemplate, CONFIG.vision.threshold, true);
  const elapsedMs = (performance.now() - startMs).toFixed(2);

  console.log("----------------------------------------------------------");
  console.log(`[TESTE DE IMAGEM] Arquivo: "${path.basename(screenshotPath)}" (${fullPng.width}x${fullPng.height})`);
  console.log(
    `  -> Status      : ${result.found ? `INTERFACE IDENTIFICADA (${result.mode})!` : "NÃO IDENTIFICADO"}`
  );
  console.log(
    `  -> Similaridade: Peixe Exato=${(result.fullScore * 100).toFixed(1)}% | Moldura Barra=${(result.frameScore * 100).toFixed(1)}% | Botão PARAR=${(result.stopScore * 100).toFixed(1)}% (Limiar=${(CONFIG.vision.threshold * 100).toFixed(0)}%)`
  );
  console.log(
    `  -> Posição     : ROI(${result.x}, ${result.y}) -> Tela(${rx + result.x}, ${ry + result.y}) [Tempo: ${elapsedMs}ms]`
  );
  console.log("----------------------------------------------------------");

  return result.found;
}

function runScreenshotSelfTest(): boolean {
  const primaryOk = evaluatePngScreenshot(CONFIG.vision.testScreenshotPath);
  if (fs.existsSync(CONFIG.vision.legacyScreenshotPath)) {
    evaluatePngScreenshot(CONFIG.vision.legacyScreenshotPath);
  }
  return primaryOk;
}

// ============================================================================
// CICLO DE AUTOMAÇÃO DE PESCA
// ============================================================================
const TRIM_SCRIPT_PATH = path.resolve(ROOT_DIR, "trim_ram.ps1");
let lastSystemTrimMs = 0;

function forceGarbageCollection(triggerSystemTrim = false): void {
  if (typeof global.gc === "function") {
    global.gc();
  }
  if (!triggerSystemTrim) return;

  const now = Date.now();
  if (now - lastSystemTrimMs < 20000) return;
  if (!fs.existsSync(TRIM_SCRIPT_PATH)) return;

  lastSystemTrimMs = now;
  execFile(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      TRIM_SCRIPT_PATH,
    ],
    { windowsHide: true, timeout: 10000 },
    () => {}
  );
}

async function waitForFishInROI(): Promise<{
  match: MatchResult | null;
  maxScoreSeen: number;
  validCapture: boolean;
}> {
  const startTime = Date.now();
  let maxScoreSeen = 0;
  let validCapture = false;
  let pollCount = 0;

  while (fishingRunning && Date.now() - startTime < CONFIG.timings.biteTimeoutMs) {
    const capture = captureROI();
    if (capture && capture.data && isBufferNonEmpty(capture.data)) {
      validCapture = true;
      const match = matchTemplateBGRA(
        capture.data,
        capture.width,
        capture.height,
        fishTemplate,
        CONFIG.vision.threshold
      );

      if (match.score > maxScoreSeen) {
        maxScoreSeen = match.score;
      }

      if (match.found) {
        forceGarbageCollection(false);
        return { match, maxScoreSeen, validCapture };
      }
    }

    if (++pollCount % 10 === 0) {
      forceGarbageCollection(false);
    }

    await sleep(CONFIG.timings.pollingIntervalMs);
  }

  forceGarbageCollection(false);
  return { match: null, maxScoreSeen, validCapture };
}

async function performCaptureClicks(): Promise<number> {
  const pressMs = Math.max(1, CONFIG.timings.clickPressMs);
  const releaseMs = Math.max(1, CONFIG.timings.clickReleaseMs);
  const cycleMs = pressMs + releaseMs;
  const targetClicks = Math.max(1, Math.round(CONFIG.timings.captureDurationMs / cycleMs));

  const startTime = Date.now();
  let clicks = 0;

  while (
    fishingRunning &&
    clicks < targetClicks &&
    Date.now() - startTime < CONFIG.timings.captureDurationMs
  ) {
    await bot.mouse.click("left", pressMs, releaseMs);
    clicks++;
  }

  return clicks;
}

async function ensureFishingRodEquipped(cycleCount: number, isTimeout = false): Promise<void> {
  if (!fishingRunning) return;

  await bot.mouse.toggle("left", false).catch(() => {});

  const preDelay = isTimeout ? 300 : CONFIG.timings.postCaptureDelayMs;
  console.log(
    `[CICLO #${cycleCount}] 4/4 Aguardando ${preDelay}ms pós-captura e trocando slots: tecla [${CONFIG.hotbar.resetSlotKey}] -> tecla [${CONFIG.hotbar.rodSlotKey}]...`
  );

  await sleep(preDelay);
  if (!fishingRunning) return;

  const resetKey = String(CONFIG.hotbar.resetSlotKey);
  hotkeyManager.markInjectedKey(resetKey, CONFIG.timings.keyPressMs + 100);
  try {
    await bot.keyboard.sendKey(
      CONFIG.hotbar.resetSlotKey,
      CONFIG.timings.keyPressMs,
      CONFIG.timings.slotSwitchDelayMs
    );
  } finally {
    hotkeyManager.unmarkInjectedKey(resetKey);
  }

  if (!fishingRunning) return;

  const rodKey = String(CONFIG.hotbar.rodSlotKey);
  hotkeyManager.markInjectedKey(rodKey, CONFIG.timings.keyPressMs + 100);
  try {
    await bot.keyboard.sendKey(
      CONFIG.hotbar.rodSlotKey,
      CONFIG.timings.keyPressMs,
      CONFIG.timings.postEquipDelayMs
    );
  } finally {
    hotkeyManager.unmarkInjectedKey(rodKey);
  }
}

async function runFishingLoop(): Promise<void> {
  if (loopActive) return;
  loopActive = true;

  let cycleCount = 0;

  try {
    while (fishingRunning) {
      if (!ensureRobloxWindow()) {
        console.warn("[AVISO] Janela do Roblox não encontrada. Tentando novamente em 1s...");
        await sleep(1000);
        continue;
      }

      if (!bot.workwindow.isForeground()) {
        bot.workwindow.setForeground();
        await sleep(100);
      }

      cycleCount++;
      console.log(`\n[CICLO #${cycleCount}] 1/4 Lançando a linha (segurando por ${CONFIG.timings.castHoldMs}ms)...`);

      await bot.mouse.toggle("left", false).catch(() => {});
      await sleep(60);
      if (!fishingRunning) break;
      await bot.mouse.toggle("left", true);
      await sleep(CONFIG.timings.castHoldMs);
      await bot.mouse.toggle("left", false);

      if (!fishingRunning) break;

      console.log(
        `[CICLO #${cycleCount}] 2/4 Monitorando ROI (${CONFIG.roi.x}, ${CONFIG.roi.y}, ${CONFIG.roi.width}x${CONFIG.roi.height}) [timeout: ${CONFIG.timings.biteTimeoutMs}ms]...`
      );
      const { match, maxScoreSeen, validCapture } = await waitForFishInROI();

      if (!fishingRunning) break;

      if (!match) {
        if (CONFIG.hotbar.enabled) {
          console.log(
            `[CICLO #${cycleCount}] Timeout de ${CONFIG.timings.biteTimeoutMs}ms sem detectar o peixe (Maior similaridade lida: ${(maxScoreSeen * 100).toFixed(1)}% | Captura válida: ${validCapture ? "Sim" : "Não"}). Reequipando vara [tecla ${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey}] e reiniciando...`
          );
          await ensureFishingRodEquipped(cycleCount, true);
        } else {
          console.log(
            `[CICLO #${cycleCount}] Timeout de ${CONFIG.timings.biteTimeoutMs}ms sem detectar o peixe (Maior similaridade lida: ${(maxScoreSeen * 100).toFixed(1)}% | Captura válida: ${validCapture ? "Sim" : "Não"}). Reiniciando...`
          );
        }
        forceGarbageCollection(true);
        continue;
      }

      console.log(
        `[CICLO #${cycleCount}] Peixe detectado (${match.mode})! Similaridade: ${(match.score * 100).toFixed(1)}% em ROI(${match.x}, ${match.y}) / Tela(${CONFIG.roi.x + match.x}, ${CONFIG.roi.y + match.y}).`
      );

      const effectiveCps = (1000 / (CONFIG.timings.clickPressMs + CONFIG.timings.clickReleaseMs)).toFixed(1);
      console.log(
        `[CICLO #${cycleCount}] 3/4 Capturando (~${effectiveCps} CPS [${CONFIG.timings.clickPressMs}ms press / ${CONFIG.timings.clickReleaseMs}ms solto] por ${CONFIG.timings.captureDurationMs}ms)...`
      );
      const clicksExecuted = await performCaptureClicks();
      console.log(`[CICLO #${cycleCount}] Fase de captura concluída (${clicksExecuted} cliques).`);

      if (!fishingRunning) break;

      if (CONFIG.hotbar.enabled) {
        await ensureFishingRodEquipped(cycleCount, false);
      } else {
        console.log(
          `[CICLO #${cycleCount}] 4/4 Aguardando resfriamento/coleta (${CONFIG.timings.cooldownMs}ms)...`
        );
        await sleep(CONFIG.timings.cooldownMs);
      }

      forceGarbageCollection(true);
    }
  } catch (err) {
    console.error("[ERRO] Falha durante o ciclo de pesca:", err);
    fishingRunning = false;
  } finally {
    await bot.mouse.toggle("left", false).catch(() => {});
    loopActive = false;
  }
}

// ============================================================================
// COORDENAÇÃO MÚTUA ENTRE PESCA E MACRO
// ============================================================================
async function stopFishing(silent = false): Promise<void> {
  const wasActive = fishingRunning || loopActive;
  fishingRunning = false;

  for (let i = 0; i < 20 && loopActive; i++) {
    await sleep(10);
  }
  await bot.mouse.toggle("left", false).catch(() => {});

  if (wasActive && !silent) {
    const keyLabel = hotkeyManager.getBinding("toggleFishing").canonical;
    console.log("\n==========================================");
    console.log(` [${keyLabel}] PESCA PAUSADA`);
    console.log("==========================================");
  }
}

async function startFishing(): Promise<void> {
  if (fishingRunning) return;

  if (macroEngine.isRunning) {
    await macroEngine.stop(true);
    console.log("\n[MODO] Macro pausado automaticamente para iniciar Pesca.");
    await sleep(80);
  }

  fishingRunning = true;
  const keyLabel = hotkeyManager.getBinding("toggleFishing").canonical;
  console.log("\n==========================================");
  console.log(` [${keyLabel}] PESCA INICIADA`);
  console.log("==========================================");
  void runFishingLoop();
}

async function startMacro(): Promise<void> {
  if (macroEngine.isRunning) return;

  if (fishingRunning || loopActive) {
    await stopFishing(true);
    console.log("\n[MODO] Pesca pausada automaticamente para iniciar Macro.");
    await sleep(80);
  }

  const keyLabel = hotkeyManager.getBinding("toggleMacro").canonical;
  macroEngine.start(keyLabel);
}

async function stopAllAutomations(silent = false): Promise<void> {
  const hadFishing = fishingRunning || loopActive;
  const hadMacro = macroEngine.isRunning;

  if (hadFishing) {
    await stopFishing(true);
  }
  if (hadMacro) {
    await macroEngine.stop(true);
  }

  await bot.mouse.toggle("left", false).catch(() => {});
  await screenBot.mouse.toggle("left", false).catch(() => {});

  if (!silent) {
    if (hadFishing || hadMacro) {
      console.log("\n[PARADO] Todas as automações foram interrompidas (mouse e teclas liberados).");
    } else {
      console.log("\n[PARADO] Nenhuma automação estava em execução.");
    }
  }
}

async function cleanExit(): Promise<void> {
  const keyLabel = hotkeyManager.getBinding("exitProcess").canonical;
  console.log("\n==========================================");
  console.log(` [${keyLabel}] ENCERRANDO PROCESSO...`);
  console.log("==========================================");
  await stopAllAutomations(true);
  hotkeyManager.stop();
  rl.close();
  process.exit(0);
}

// ============================================================================
// TERMINAL INTERATIVO, ASSISTENTES E GERENCIAMENTO DE ATALHOS
// ============================================================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function clearReadlineBuffer(): void {
  (rl as unknown as { line?: string }).line = "";
}

function updatePrompt(): void {
  const estado = fishingRunning ? "PESCA ATIVA" : macroEngine.isRunning ? "MACRO ATIVO" : "Parado";
  const p = macroEngine.getCurrentProfile();
  const idx = macroEngine.getCurrentIndex() + 1;
  rl.setPrompt(`[${estado} | Macro P${idx}: ${p.nome}] > `);
}

function showPrompt(): void {
  if (cliOnlyMode || inWizard || hotkeyManager.getMode() !== "normal") return;
  updatePrompt();
  rl.prompt();
}

function askLine(query: string): Promise<string> {
  return new Promise((resolve) => {
    pendingLineResolver = resolve;
    process.stdout.write(query);
  });
}

function printCurrentFishingConfig(): void {
  const effectiveCps = (1000 / (CONFIG.timings.clickPressMs + CONFIG.timings.clickReleaseMs)).toFixed(1);
  const hotbarKey = hotkeyManager.getBinding("toggleHotbarSwitch").canonical;
  const hotbarStatus = CONFIG.hotbar.enabled
    ? `ATIVADA (Tecla [${CONFIG.hotbar.resetSlotKey}] -> Tecla [${CONFIG.hotbar.rodSlotKey}])`
    : "DESATIVADA (Apenas espera cooldown)";
  console.log("\n============= CONFIGURAÇÃO DE PESCA ATUAL =============");
  console.log(`  cast      (Tempo segurando clique no lançamento) : ${CONFIG.timings.castHoldMs} ms`);
  console.log(`  press     (Tempo pressionado em cada clique)     : ${CONFIG.timings.clickPressMs} ms`);
  console.log(`  release   (Tempo solto entre cada clique)        : ${CONFIG.timings.clickReleaseMs} ms (~${effectiveCps} CPS)`);
  console.log(`  capture   (Duração total da fase de captura)     : ${CONFIG.timings.captureDurationMs} ms`);
  console.log(`  cooldown  (Tempo de espera/coleta no final)      : ${CONFIG.timings.cooldownMs} ms`);
  console.log(`  hotbar    (Troca na hotbar [${hotbarKey}])                : ${hotbarStatus}`);
  console.log(`  timeout   (Timeout esperando o peixe morder)     : ${CONFIG.timings.biteTimeoutMs} ms`);
  console.log(`  polling   (Intervalo de verificação da ROI)      : ${CONFIG.timings.pollingIntervalMs} ms`);
  console.log(`  threshold (Sensibilidade visual 0.50 a 0.99)     : ${CONFIG.vision.threshold}`);
  console.log("=======================================================");
}

function applySingleConfigKey(key: string, rawVal: string): boolean {
  const cleanKey = key.toLowerCase();
  const cleanVal = rawVal.trim().toLowerCase();

  if (cleanKey === "hotbar" || cleanKey === "troca" || cleanKey === "slot") {
    if (["on", "true", "1", "sim", "s", "ativar", "ativo", "ligar"].includes(cleanVal)) {
      CONFIG.hotbar.enabled = true;
    } else if (["off", "false", "0", "nao", "não", "n", "desativar", "inativo", "desligar"].includes(cleanVal)) {
      CONFIG.hotbar.enabled = false;
    } else if (cleanVal === "toggle" || cleanVal === "alternar") {
      CONFIG.hotbar.enabled = !CONFIG.hotbar.enabled;
    } else {
      console.log(
        `[CONFIG] Valor inválido para hotbar: "${rawVal}". Use: on, off, sim, nao ou toggle.`
      );
      return false;
    }
    saveConfig();
    console.log(
      `[CONFIG] Troca de itens na hotbar (${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey}): ${CONFIG.hotbar.enabled ? "ATIVADA" : "DESATIVADA"}.`
    );
    return true;
  }

  const val = Number(rawVal);
  if (Number.isNaN(val) || val <= 0) {
    console.log(`[CONFIG] Valor inválido: "${rawVal}". Informe um número positivo.`);
    return false;
  }

  switch (cleanKey) {
    case "cast":
    case "lancamento":
    case "castholdms":
      CONFIG.timings.castHoldMs = Math.round(val);
      console.log(`[CONFIG] Tempo de lançamento (castHoldMs) atualizado para ${CONFIG.timings.castHoldMs}ms.`);
      break;
    case "press":
    case "clickpress":
    case "clickpressms":
      CONFIG.timings.clickPressMs = Math.max(1, Math.round(val));
      CONFIG.autoclicker.cps = Math.round(1000 / (CONFIG.timings.clickPressMs + CONFIG.timings.clickReleaseMs));
      console.log(`[CONFIG] Tempo de clique pressionado (clickPressMs) atualizado para ${CONFIG.timings.clickPressMs}ms.`);
      break;
    case "release":
    case "clickrelease":
    case "clickreleasems":
      CONFIG.timings.clickReleaseMs = Math.max(1, Math.round(val));
      CONFIG.autoclicker.cps = Math.round(1000 / (CONFIG.timings.clickPressMs + CONFIG.timings.clickReleaseMs));
      console.log(`[CONFIG] Tempo de clique solto (clickReleaseMs) atualizado para ${CONFIG.timings.clickReleaseMs}ms.`);
      break;
    case "cps": {
      CONFIG.autoclicker.cps = Math.max(1, Math.round(val));
      const half = Math.max(1, Math.round(1000 / (CONFIG.autoclicker.cps * 2)));
      CONFIG.timings.clickPressMs = half;
      CONFIG.timings.clickReleaseMs = half;
      console.log(`[CONFIG] Taxa ajustada para ${CONFIG.autoclicker.cps} CPS (${half}ms pressionado / ${half}ms solto).`);
      break;
    }
    case "capture":
    case "captura":
    case "capturedurationms":
      CONFIG.timings.captureDurationMs = Math.round(val);
      console.log(`[CONFIG] Duração da fase de captura atualizada para ${CONFIG.timings.captureDurationMs}ms.`);
      break;
    case "cooldown":
    case "resfriamento":
    case "cooldownms":
      CONFIG.timings.cooldownMs = Math.round(val);
      console.log(`[CONFIG] Tempo de resfriamento/coleta atualizado para ${CONFIG.timings.cooldownMs}ms.`);
      break;
    case "timeout":
    case "bitetimeoutms":
      CONFIG.timings.biteTimeoutMs = Math.round(val);
      console.log(`[CONFIG] Timeout de mordida atualizado para ${CONFIG.timings.biteTimeoutMs}ms.`);
      break;
    case "polling":
    case "pollingintervalms":
      CONFIG.timings.pollingIntervalMs = Math.max(5, Math.round(val));
      console.log(`[CONFIG] Intervalo de polling atualizado para ${CONFIG.timings.pollingIntervalMs}ms.`);
      break;
    case "threshold":
    case "sensibilidade":
      CONFIG.vision.threshold = val > 1 ? val / 100 : val;
      console.log(`[CONFIG] Sensibilidade visual (threshold) atualizada para ${CONFIG.vision.threshold}.`);
      break;
    default:
      console.log(
        `[CONFIG] Parâmetro desconhecido: "${key}". Opções: cast, press, release, cps, capture, cooldown, hotbar, timeout, polling, threshold.`
      );
      return false;
  }

  saveConfig();
  return true;
}

function printHotkeysTable(): void {
  console.log("\n============= ATALHOS GLOBAIS (SEM CONFLITOS) =============");
  for (const action of ALL_HOTKEY_ACTIONS) {
    const binding = hotkeyManager.getBinding(action);
    const warning = getExternalConflictWarning(binding);
    const warnTag = warning ? `  [AVISO: ${warning}]` : "";
    console.log(
      `  ${action.padEnd(20)} | ${binding.canonical.padEnd(10)} | ${ACTION_LABELS[action]}${warnTag}`
    );
  }
  console.log("-----------------------------------------------------------");
  console.log("  Comandos: 'atalho <acao> <tecla>' | 'atalho <acao> capturar' | 'atalhos reset'");
  console.log("  Ações   : pesca, macro, hotbar, perfil, parar, sair");
  console.log("===========================================================\n");
}

function printStatus(): void {
  const modeLabel = fishingRunning ? "PESCA ATIVA" : macroEngine.isRunning ? "MACRO ATIVO" : "Parado";
  const p = macroEngine.getCurrentProfile();
  const idx = macroEngine.getCurrentIndex() + 1;
  console.log("\n==================== STATUS UNIFICADO =====================");
  console.log(`  Estado atual   : ${modeLabel}`);
  console.log(`  ROI (Pesca)    : x=${CONFIG.roi.x}, y=${CONFIG.roi.y}, ${CONFIG.roi.width}x${CONFIG.roi.height} (limiar=${CONFIG.vision.threshold})`);
  console.log(`  Hotbar (Pesca) : ${CONFIG.hotbar.enabled ? `ATIVADA (${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey})` : "DESATIVADA"}`);
  console.log(`  Macro Perfil   : #${idx} ${p.nome} | Mouse: ${macroEngine.formatMouse(p)} | Ciclo: ${p.cicloDelay}ms`);
  console.log(`  Macro Teclas   : ${macroEngine.formatSequence(p.teclas)}`);
  console.log(
    `  Atalhos        : Pesca=[${hotkeyManager.getBinding("toggleFishing").canonical}] Macro=[${hotkeyManager.getBinding("toggleMacro").canonical}] Hotbar=[${hotkeyManager.getBinding("toggleHotbarSwitch").canonical}] Perfil=[${hotkeyManager.getBinding("nextMacroProfile").canonical}] Parar=[${hotkeyManager.getBinding("stopAll").canonical}] Sair=[${hotkeyManager.getBinding("exitProcess").canonical}]`
  );
  console.log("===========================================================\n");
}

function printHelp(): void {
  const hkFish = hotkeyManager.getBinding("toggleFishing").canonical;
  const hkMacro = hotkeyManager.getBinding("toggleMacro").canonical;
  const hkHotbar = hotkeyManager.getBinding("toggleHotbarSwitch").canonical;
  const hkProfile = hotkeyManager.getBinding("nextMacroProfile").canonical;
  const hkStop = hotkeyManager.getBinding("stopAll").canonical;
  const hkExit = hotkeyManager.getBinding("exitProcess").canonical;

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    BOT UNIFICADO — PESCA + MACROS / AUTOCLICK                ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ ATALHOS GLOBAIS (SEM CONFLITOS)                                              ║
║   ${hkFish.padEnd(12)} Iniciar / Pausar automação de PESCA                        ║
║   ${hkMacro.padEnd(12)} Iniciar / Pausar MACRO / AUTOCLICKER (perfil atual)        ║
║   ${hkHotbar.padEnd(12)} Ativar / Desativar troca de Hotbar na Pesca (1 -> 3)       ║
║   ${hkProfile.padEnd(12)} Alternar para o próximo perfil de Macro (1-5)              ║
║   ${hkStop.padEnd(12)} Parar imediatamente qualquer automação ativa               ║
║   ${hkExit.padEnd(12)} Encerrar o bot de forma limpa                              ║
║                                                                              ║
║ PESCA (TERMINAL)                                                             ║
║   pesca                   Liga/desliga a pesca (ou: pesca on/off)            ║
║   pesca config            Assistente passo a passo dos tempos da pesca       ║
║   pesca <chave> <valor>   Altera parâmetro (cast, press, release, cps, ...)  ║
║   hotbar [on|off|toggle]  Liga/desliga troca de slot 1 -> 3                  ║
║   test                    Executa teste visual em nova_interface.png         ║
║                                                                              ║
║ MACROS & PERFIS (TERMINAL)                                                   ║
║   macro [on|off]          Liga/desliga o perfil de macro atual               ║
║   perfis                  Lista os ${MAX_PROFILES} perfis salvos                          ║
║   perfil <1-${MAX_PROFILES}>            Seleciona o perfil desejado                        ║
║   ver                     Mostra detalhes completos do perfil atual          ║
║   nome <texto>            Renomeia o perfil atual                            ║
║   gravar                  Grava sequência de teclas e pergunta os tempos       ║
║   gravar real             Grava teclas medindo o tempo real segurado         ║
║   tecla <n> <ms>          Ajusta tempo (ms) da tecla #n do perfil            ║
║   teclas <ms>             Ajusta tempo (ms) de TODAS as teclas do perfil     ║
║   ciclo <ms>              Define espera (ms) após cada repetição do ciclo    ║
║   mouse [on|off|<ms>]     Configura autoclick do mouse (interativo ou ms)    ║
║   cps <cliques/s>         Define velocidade do mouse do macro em CPS         ║
║   limpar                  Apaga as teclas do perfil atual                    ║
║                                                                              ║
║ GERENCIAMENTO DE ATALHOS & GERAL                                             ║
║   atalhos                 Lista atalhos globais atuais                       ║
║   atalho <acao> <tecla>   Muda atalho (ex: atalho macro Shift+F9)            ║
║   atalho <acao> capturar  Captura tecla ao vivo (ESC cancela)                ║
║   atalhos reset           Restaura atalhos padrão sem conflitos              ║
║   config                  Menu rápido de configuração (Pesca/Macro/Atalhos)  ║
║   status | parar | sair   Exibe status, para tudo ou fecha o programa        ║
╚══════════════════════════════════════════════════════════════════════════════╝`);
  printCurrentFishingConfig();
}

async function runFishingConfigWizard(exitAfter = false): Promise<void> {
  const wasActive = fishingRunning || macroEngine.isRunning;
  if (wasActive) {
    await stopAllAutomations(true);
    console.log("[CONFIG] Automações pausadas temporariamente para ajuste de configuração.");
  }

  inWizard = true;
  try {
    console.log("\n=== ASSISTENTE DE CONFIGURAÇÃO DE PESCA (ENTER mantém o atual) ===");

    const castAns = (
      await askLine(`1. Tempo segurando o clique no lançamento [atual: ${CONFIG.timings.castHoldMs}ms]: `)
    ).trim();
    if (castAns) applySingleConfigKey("cast", castAns);

    const pressAns = (
      await askLine(`2. Tempo do clique PRESSIONADO na captura [atual: ${CONFIG.timings.clickPressMs}ms]: `)
    ).trim();
    if (pressAns) applySingleConfigKey("press", pressAns);

    const releaseAns = (
      await askLine(`3. Tempo do clique SOLTO na captura [atual: ${CONFIG.timings.clickReleaseMs}ms]: `)
    ).trim();
    if (releaseAns) applySingleConfigKey("release", releaseAns);

    const captureAns = (
      await askLine(`4. Duração total da fase de captura [atual: ${CONFIG.timings.captureDurationMs}ms]: `)
    ).trim();
    if (captureAns) applySingleConfigKey("capture", captureAns);

    const cooldownAns = (
      await askLine(`5. Tempo de espera/coleta após captura [atual: ${CONFIG.timings.cooldownMs}ms]: `)
    ).trim();
    if (cooldownAns) applySingleConfigKey("cooldown", cooldownAns);

    const hotbarAns = (
      await askLine(
        `6. Ativar troca de itens na hotbar (${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey})? (sim/nao) [atual: ${CONFIG.hotbar.enabled ? "sim" : "nao"}]: `
      )
    ).trim();
    if (hotbarAns) applySingleConfigKey("hotbar", hotbarAns);

    const timeoutAns = (
      await askLine(`7. Timeout esperando peixe morder [atual: ${CONFIG.timings.biteTimeoutMs}ms]: `)
    ).trim();
    if (timeoutAns) applySingleConfigKey("timeout", timeoutAns);

    const thresholdAns = (
      await askLine(`8. Limiar de sensibilidade visual (0.50 a 0.99) [atual: ${CONFIG.vision.threshold}]: `)
    ).trim();
    if (thresholdAns) applySingleConfigKey("threshold", thresholdAns);

    saveConfig();
    console.log("[CONFIG] Configurações de pesca salvas com sucesso em config.json!");
    printCurrentFishingConfig();

    if (exitAfter) {
      hotkeyManager.stop();
      rl.close();
      process.exit(0);
    } else if (wasActive) {
      const hk = hotkeyManager.getBinding("toggleFishing").canonical;
      console.log(`[CONFIG] Pressione [${hk}] quando quiser retomar a pesca.`);
    }
  } finally {
    inWizard = false;
  }
}

async function runMouseAssistant(): Promise<void> {
  if (fishingRunning || macroEngine.isRunning) {
    await stopAllAutomations(true);
  }

  inWizard = true;
  try {
    const p = macroEngine.getCurrentProfile();
    const idx = macroEngine.getCurrentIndex() + 1;
    console.log(`\n=== CONFIGURAÇÃO DO AUTOCLICK (MOUSE) — Perfil ${idx}: ${p.nome} ===`);

    const ans = (
      await askLine(`Usar autoclick do mouse neste perfil? (s/n) [Enter = ${p.mouse ? "s" : "n"}]: `)
    )
      .trim()
      .toLowerCase();

    if (ans === "s" || ans === "sim" || ans === "on") {
      macroEngine.setMouseEnabled(true);
    } else if (ans === "n" || ans === "nao" || ans === "não" || ans === "off") {
      macroEngine.setMouseEnabled(false);
    }

    if (!macroEngine.getCurrentProfile().mouse) {
      console.log(`[OK] Autoclick do mouse DESLIGADO no Perfil ${idx}.\n`);
      return;
    }

    const ans2 = (
      await askLine(
        `Qual o intervalo entre cliques em ms? (Ex: 200 = 5 cliques/s, 50 = 20 cliques/s) [Enter = ${macroEngine.getCurrentProfile().mouseDelay}ms]: `
      )
    ).trim();

    if (ans2 !== "") {
      const val = parseInt(ans2, 10);
      if (Number.isFinite(val) && val >= 10) {
        macroEngine.setMouseDelay(val);
      } else {
        console.log("[!] Valor inválido (mínimo 10ms). Mantendo valor anterior.");
      }
    }

    console.log(`[OK] Autoclick configurado: ${macroEngine.formatMouse()}\n`);
  } finally {
    inWizard = false;
  }
}

async function finishMacroRecordingWizard(
  recordedSteps: MacroKeyStep[],
  realMode: boolean
): Promise<void> {
  try {
    if (recordedSteps.length === 0) {
      console.log("\n[!] Nenhuma tecla foi pressionada. A sequência anterior foi mantida.");
      console.log("=== Voltando ao MENU ===\n");
      return;
    }

    console.log(
      `\n[OK] ${recordedSteps.length} tecla(s) capturada(s): ${macroEngine.formatSequence(recordedSteps)}`
    );
    console.log("\n--- Ajuste de Tempos da Sequência ---");

    const modeChoice = (
      await askLine(
        `Como deseja definir o tempo que cada tecla fica pressionada?\n` +
          `  [Enter] Manter os tempos mostrados acima (${realMode ? "tempo segurado" : DEFAULT_KEY_HOLD + "ms"})\n` +
          `  [Número] Definir um mesmo tempo em ms para TODAS as teclas (ex: 50)\n` +
          `  [i] Configurar o tempo de cada tecla individualmente\n` +
          `Escolha: `
      )
    )
      .trim()
      .toLowerCase();

    if (modeChoice === "i") {
      for (let i = 0; i < recordedSteps.length; i++) {
        const item = recordedSteps[i];
        const ans = (
          await askLine(
            `  Tecla #${i + 1} "${item.tecla}" — tempo pressionada em ms [Enter = ${item.duracao}ms]: `
          )
        ).trim();
        const val = parseInt(ans, 10);
        if (Number.isFinite(val) && val >= 1) {
          item.duracao = val;
        }
      }
    } else if (modeChoice !== "") {
      const val = parseInt(modeChoice, 10);
      if (Number.isFinite(val) && val >= 1) {
        recordedSteps.forEach((s) => {
          s.duracao = val;
        });
        console.log(`  -> Todas as teclas ajustadas para ${val}ms.`);
      } else {
        console.log("  -> Valor inválido, mantendo tempos atuais.");
      }
    }

    const currentCycle = macroEngine.getCurrentProfile().cicloDelay;
    const cycleAns = (
      await askLine(
        `\nDe quanto em quanto tempo (em ms) o ciclo inteiro deve se repetir?\n` +
          `(Intervalo de espera após terminar a sequência antes de recomeçar) [Enter = ${currentCycle}ms]: `
      )
    ).trim();

    let nextCycle = currentCycle;
    if (cycleAns !== "") {
      const val = parseInt(cycleAns, 10);
      if (Number.isFinite(val) && val >= 0) {
        nextCycle = val;
      } else {
        console.log("[!] Valor inválido, mantendo o intervalo anterior.");
      }
    }

    macroEngine.updateRecordedKeys(recordedSteps, nextCycle);
    console.log(
      `\n[OK] Perfil ${macroEngine.getCurrentIndex() + 1} (${macroEngine.getCurrentProfile().nome}) atualizado com sucesso!`
    );
    macroEngine.printCurrentProfile();
  } finally {
    inWizard = false;
    showPrompt();
  }
}

async function startMacroRecording(realMode: boolean): Promise<void> {
  if (fishingRunning || macroEngine.isRunning) {
    await stopAllAutomations(true);
  }

  inWizard = true;
  const recordedSteps: MacroKeyStep[] = [];
  const profile = macroEngine.getCurrentProfile();
  const reservedSimple = ALL_HOTKEY_ACTIONS.map((a) => hotkeyManager.getBinding(a))
    .filter((b) => !b.ctrl && !b.alt && !b.shift && !b.meta)
    .map((b) => b.canonical)
    .join(", ");

  console.log("");
  console.log(
    `=== GRAVANDO TECLAS — Perfil ${macroEngine.getCurrentIndex() + 1}: ${profile.nome} ===`
  );
  if (realMode) {
    console.log("Modo: TEMPO REAL (o tempo que você segurar cada tecla será gravado automaticamente).");
  } else {
    console.log("Modo: PADRÃO (ao finalizar com ESC, você poderá definir o tempo de cada tecla e do ciclo).");
  }
  console.log("  -> Pressione as teclas na ordem desejada.");
  console.log("  -> Pressione ESC para finalizar a gravação.");
  if (reservedSimple) {
    console.log(`  (Obs.: atalhos globais simples [${reservedSimple}] são reservados e bloqueados)`);
  }
  console.log("Sequência atual: (vazia)\n");

  rl.pause();

  hotkeyManager.startMacroRecording({
    onKeyDown: (keysenderKey) => {
      if (recordedSteps.length >= MAX_TECLAS) {
        console.log(`[!] Limite de ${MAX_TECLAS} teclas atingido. Pressione ESC para finalizar.`);
        return;
      }
      if (!realMode) {
        recordedSteps.push({ tecla: keysenderKey, duracao: DEFAULT_KEY_HOLD });
        console.log(
          `  + Tecla #${recordedSteps.length}: "${keysenderKey}" | Sequência: ${macroEngine.formatSequence(recordedSteps)}`
        );
      }
    },
    onKeyUp: (keysenderKey, _keyName, durationMs) => {
      if (!realMode) return;
      if (recordedSteps.length >= MAX_TECLAS) return;
      recordedSteps.push({ tecla: keysenderKey, duracao: durationMs });
      console.log(
        `  + Tecla #${recordedSteps.length}: "${keysenderKey}" segurada por ${durationMs}ms | Sequência: ${macroEngine.formatSequence(recordedSteps)}`
      );
    },
    onBlockedKey: (keyName, actionLabel) => {
      console.log(`[!] Tecla "${keyName}" reservada para "${actionLabel}" e não pode ser gravada.`);
    },
    onUnsupportedKey: (keycode) => {
      console.log(`[!] Tecla não suportada (código ${keycode}), ignorada.`);
    },
    onFinish: () => {
      clearReadlineBuffer();
      ignoreLinesUntil = Date.now() + 250;
      rl.resume();
      setTimeout(() => {
        void finishMacroRecordingWizard(recordedSteps, realMode);
      }, 120);
    },
  });
}

async function startLiveHotkeyCapture(action: HotkeyAction): Promise<void> {
  if (fishingRunning || macroEngine.isRunning) {
    await stopAllAutomations(true);
  }

  inWizard = true;
  console.log(
    `\n[ATALHOS] Pressione a nova tecla ou combinação (ex: F6, Shift+F7, Ctrl+F8) para "${ACTION_LABELS[action]}".`
  );
  console.log("          (Pressione ESC para cancelar)\n");
  rl.pause();

  hotkeyManager.startHotkeyCapture((captured) => {
    clearReadlineBuffer();
    ignoreLinesUntil = Date.now() + 200;
    rl.resume();

    setTimeout(() => {
      try {
        if (!captured) {
          console.log("[ATALHOS] Captura cancelada.");
          return;
        }

        const res = hotkeyManager.setBinding(
          action,
          captured.canonical,
          macroEngine.getAllUsedKeys()
        );
        if (!res.ok) {
          console.log(`[ATALHOS] ${res.error}`);
          return;
        }

        CONFIG.hotkeys = hotkeyManager.getConfigSnapshot();
        saveConfig();
        console.log(`[ATALHOS] "${ACTION_LABELS[action]}" atualizado para [${res.parsed!.canonical}].`);
        if (res.warning) {
          console.log(`[AVISO] ${res.warning}`);
        }
      } finally {
        inWizard = false;
        showPrompt();
      }
    }, 100);
  });
}

async function runQuickConfigMenu(): Promise<void> {
  inWizard = true;
  let choice = "";
  try {
    choice = (
      await askLine(
        "\nConfigurar: [1] Pesca  [2] Gravar Macro (padrão)  [3] Gravar Macro (tempo real)  [4] Ver Atalhos  [Enter] Voltar: "
      )
    )
      .trim()
      .toLowerCase();
  } finally {
    inWizard = false;
  }

  if (choice === "1" || choice === "pesca") {
    await runFishingConfigWizard(false);
  } else if (choice === "2" || choice === "macro") {
    await startMacroRecording(false);
  } else if (choice === "3" || choice === "real") {
    await startMacroRecording(true);
  } else if (choice === "4" || choice === "atalhos") {
    printHotkeysTable();
  }
}

async function handleHotkeyCommand(args: string[]): Promise<boolean> {
  const first = (args[0] || "").toLowerCase();
  if (!first) {
    printHotkeysTable();
    return false;
  }

  if (first === "reset" || first === "padrao" || first === "padrão") {
    hotkeyManager.resetToDefaults();
    CONFIG.hotkeys = hotkeyManager.getConfigSnapshot();
    saveConfig();
    console.log("[ATALHOS] Atalhos restaurados para o padrão sem conflitos.");
    printHotkeysTable();
    return false;
  }

  const action = resolveActionName(first);
  if (!action) {
    console.log(
      `[ATALHOS] Ação desconhecida: "${args[0]}". Use: pesca, macro, hotbar, perfil, parar ou sair.`
    );
    return false;
  }

  const spec = args.slice(1).join(" ").trim();
  if (!spec) {
    console.log(
      `[ATALHOS] Uso: atalho ${first} <tecla> (ex: atalho ${first} Shift+F9) ou "atalho ${first} capturar".`
    );
    return false;
  }

  if (spec.toLowerCase() === "capturar" || spec.toLowerCase() === "capture") {
    await startLiveHotkeyCapture(action);
    return true;
  }

  const res = hotkeyManager.setBinding(action, spec, macroEngine.getAllUsedKeys());
  if (!res.ok) {
    console.log(`[ATALHOS] ${res.error}`);
    return false;
  }

  CONFIG.hotkeys = hotkeyManager.getConfigSnapshot();
  saveConfig();
  console.log(`[ATALHOS] "${ACTION_LABELS[action]}" atualizado para [${res.parsed!.canonical}].`);
  if (res.warning) {
    console.log(`[AVISO] ${res.warning}`);
  }
  return false;
}

async function handleConsoleCommand(line: string): Promise<void> {
  const parts = line.trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const args = parts.slice(1);
  const rest = args.join(" ");

  if (!cmd) {
    showPrompt();
    return;
  }

  let handledAsyncSubMode = false;

  switch (cmd) {
    case "ajuda":
    case "help":
      printHelp();
      break;

    case "status":
      printStatus();
      break;

    case "parar":
    case "stop":
      await stopAllAutomations(false);
      break;

    case "test":
      runScreenshotSelfTest();
      break;

    case "hotbar":
      applySingleConfigKey("hotbar", args[0] ?? "toggle");
      break;

    case "pesca": {
      const sub = (args[0] || "").toLowerCase();
      if (!sub || sub === "toggle" || sub === "alternar") {
        if (fishingRunning) await stopFishing();
        else await startFishing();
      } else if (sub === "on" || sub === "start" || sub === "iniciar" || sub === "ligar") {
        await startFishing();
      } else if (sub === "off" || sub === "stop" || sub === "parar" || sub === "desligar") {
        await stopFishing();
      } else if (sub === "config" || sub === "wizard") {
        await runFishingConfigWizard(false);
      } else if (args.length >= 2) {
        applySingleConfigKey(args[0], args[1]);
      } else {
        printCurrentFishingConfig();
      }
      break;
    }

    case "macro": {
      const sub = (args[0] || "").toLowerCase();
      if (!sub || sub === "toggle" || sub === "alternar") {
        if (macroEngine.isRunning) await macroEngine.stop();
        else await startMacro();
      } else if (sub === "on" || sub === "start" || sub === "iniciar" || sub === "ligar") {
        await startMacro();
      } else if (sub === "off" || sub === "stop" || sub === "parar" || sub === "desligar") {
        await macroEngine.stop();
      } else if (sub === "config") {
        await startMacroRecording(false);
        handledAsyncSubMode = true;
      } else if (sub === "real") {
        await startMacroRecording(true);
        handledAsyncSubMode = true;
      } else {
        macroEngine.printCurrentProfile();
      }
      break;
    }

    case "config": {
      const sub = (args[0] || "").toLowerCase();
      if (!sub) {
        await runQuickConfigMenu();
        if (hotkeyManager.getMode() !== "normal") handledAsyncSubMode = true;
      } else if (sub === "pesca") {
        await runFishingConfigWizard(false);
      } else if (sub === "macro") {
        await startMacroRecording(false);
        handledAsyncSubMode = true;
      } else if (sub === "real") {
        await startMacroRecording(true);
        handledAsyncSubMode = true;
      } else if (sub === "hotbar" && args.length === 1) {
        applySingleConfigKey("hotbar", "toggle");
      } else if (args.length >= 2) {
        applySingleConfigKey(args[0], args[1]);
      } else {
        printCurrentFishingConfig();
      }
      break;
    }

    case "gravar": {
      const realMode = (args[0] || "").toLowerCase() === "real";
      await startMacroRecording(realMode);
      handledAsyncSubMode = true;
      break;
    }

    case "perfis":
      macroEngine.printProfilesList();
      break;

    case "perfil": {
      const n = parseInt(args[0] || "", 10);
      if (!(n >= 1 && n <= MAX_PROFILES)) {
        console.log(`[!] Informe um número de 1 a ${MAX_PROFILES}. Exemplo: perfil 2`);
        break;
      }
      await macroEngine.setCurrentIndex(n - 1);
      console.log(`[OK] Agora você está no Perfil ${n}: ${macroEngine.getCurrentProfile().nome}.`);
      macroEngine.printCurrentProfile();
      break;
    }

    case "ver":
      macroEngine.printCurrentProfile();
      break;

    case "nome":
      if (!rest) {
        console.log("[!] Use: nome <novo nome do perfil>");
        break;
      }
      macroEngine.renameCurrent(rest);
      console.log(
        `[OK] Perfil ${macroEngine.getCurrentIndex() + 1} renomeado para "${rest}".`
      );
      break;

    case "tecla": {
      const p = macroEngine.getCurrentProfile();
      if (p.teclas.length === 0) {
        console.log('[!] Este perfil ainda não tem teclas gravadas. Use "gravar" primeiro.');
        break;
      }
      const idx = parseInt(args[0] || "", 10);
      const msVal = parseInt(args[1] || "", 10);
      if (!macroEngine.setKeyDuration(idx, msVal)) {
        console.log(`[!] Use: tecla <posição 1-${p.teclas.length}> <tempo_ms>`);
        console.log(`    Exemplo: tecla 1 150`);
        break;
      }
      console.log(
        `[OK] Tecla #${idx} ("${p.teclas[idx - 1].tecla}") agora fica pressionada por ${msVal}ms.`
      );
      break;
    }

    case "teclas": {
      const p = macroEngine.getCurrentProfile();
      if (p.teclas.length === 0) {
        console.log('[!] Este perfil ainda não tem teclas gravadas. Use "gravar" primeiro.');
        break;
      }
      const msVal = parseInt(args[0] || "", 10);
      if (!macroEngine.setAllKeysDuration(msVal)) {
        console.log("[!] Use: teclas <tempo_ms> (ex: teclas 80)");
        break;
      }
      console.log(
        `[OK] Todas as teclas do Perfil ${macroEngine.getCurrentIndex() + 1} agora ficam pressionadas por ${msVal}ms.`
      );
      break;
    }

    case "ciclo": {
      const msVal = parseInt(args[0] || "", 10);
      if (!macroEngine.setCycleDelay(msVal)) {
        console.log("[!] Use: ciclo <tempo_ms> (ex: ciclo 500)");
        break;
      }
      console.log(
        `[OK] O ciclo do Perfil ${macroEngine.getCurrentIndex() + 1} agora se repete a cada ${msVal}ms.`
      );
      break;
    }

    case "mouse": {
      const arg = (args[0] || "").toLowerCase();
      if (!arg) {
        await runMouseAssistant();
        break;
      }
      if (arg === "on" || arg === "sim" || arg === "ligar") {
        macroEngine.setMouseEnabled(true);
        console.log(`[OK] Autoclick do mouse LIGADO: ${macroEngine.formatMouse()}`);
      } else if (arg === "off" || arg === "nao" || arg === "não" || arg === "desligar") {
        macroEngine.setMouseEnabled(false);
        console.log(
          `[OK] Autoclick do mouse DESLIGADO no Perfil ${macroEngine.getCurrentIndex() + 1}.`
        );
      } else {
        const msVal = parseInt(arg, 10);
        if (macroEngine.setMouseDelay(msVal)) {
          console.log(`[OK] Velocidade do autoclick ajustada: ${macroEngine.formatMouse()}`);
        } else {
          console.log(
            '[!] Use: "mouse" (interativo), "mouse on", "mouse off" ou "mouse <ms>" (mínimo 10ms).'
          );
        }
      }
      break;
    }

    case "cps": {
      const cps = parseFloat((args[0] || "").replace(",", "."));
      if (!macroEngine.setMouseCps(cps)) {
        console.log("[!] Use: cps <cliques_por_segundo> (de 0.1 até 100, ex: cps 10)");
        break;
      }
      console.log(`[OK] Velocidade do autoclick ajustada: ${macroEngine.formatMouse()}`);
      break;
    }

    case "limpar":
      macroEngine.clearKeys();
      console.log(
        `[OK] Sequência de teclas do Perfil ${macroEngine.getCurrentIndex() + 1} apagada.`
      );
      break;

    case "atalhos":
    case "hotkeys":
    case "atalho":
    case "hotkey":
      handledAsyncSubMode = await handleHotkeyCommand(args);
      break;

    case "sair":
    case "exit":
      await cleanExit();
      return;

    default:
      console.log(`[!] Comando desconhecido: "${cmd}". Digite "ajuda" para ver a lista de comandos.`);
  }

  if (!handledAsyncSubMode) {
    showPrompt();
  }
}

rl.on("line", (line) => {
  if (Date.now() < ignoreLinesUntil) {
    if (!pendingLineResolver) showPrompt();
    return;
  }

  if (pendingLineResolver) {
    const resolve = pendingLineResolver;
    pendingLineResolver = null;
    resolve(line);
    return;
  }

  if (cliOnlyMode || inWizard || hotkeyManager.getMode() !== "normal") return;
  void handleConsoleCommand(line);
});

rl.on("SIGINT", () => {
  void cleanExit();
});

// ============================================================================
// REGISTRO DOS HANDLERS DE ATALHOS GLOBAIS UNIFICADOS
// ============================================================================
hotkeyManager.onAction("toggleFishing", async () => {
  if (fishingRunning) {
    await stopFishing();
  } else {
    await startFishing();
  }
  showPrompt();
});

hotkeyManager.onAction("toggleMacro", async () => {
  if (macroEngine.isRunning) {
    await macroEngine.stop();
  } else {
    await startMacro();
  }
  showPrompt();
});

hotkeyManager.onAction("toggleHotbarSwitch", () => {
  CONFIG.hotbar.enabled = !CONFIG.hotbar.enabled;
  saveConfig();
  const hk = hotkeyManager.getBinding("toggleHotbarSwitch").canonical;
  console.log(
    `\n[${hk}] Troca de itens na hotbar (${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey}): ${CONFIG.hotbar.enabled ? "ATIVADA" : "DESATIVADA"}`
  );
  showPrompt();
});

hotkeyManager.onAction("nextMacroProfile", async () => {
  const nextIdx = await macroEngine.nextProfile();
  const p = macroEngine.getCurrentProfile();
  const hk = hotkeyManager.getBinding("nextMacroProfile").canonical;
  console.log(`\n[${hk}] Perfil de Macro alterado para #${nextIdx + 1}: ${p.nome}`);
  console.log(`      Mouse: ${macroEngine.formatMouse(p)} | Teclas: ${macroEngine.formatSequence(p.teclas)}`);
  showPrompt();
});

hotkeyManager.onAction("stopAll", async () => {
  await stopAllAutomations(false);
  showPrompt();
});

hotkeyManager.onAction("exitProcess", async () => {
  await cleanExit();
});

// ============================================================================
// EXECUÇÃO INICIAL / CLI ARGS
// ============================================================================
async function main(): Promise<void> {
  const cliArg = process.argv[2]?.toLowerCase();

  if (cliArg === "test") {
    cliOnlyMode = true;
    const ok = runScreenshotSelfTest();
    rl.close();
    process.exit(ok ? 0 : 1);
  }

  if (cliArg === "config") {
    cliOnlyMode = true;
    printCurrentFishingConfig();
    if (process.argv[3] && process.argv[4]) {
      applySingleConfigKey(process.argv[3], process.argv[4]);
      rl.close();
      process.exit(0);
    }
    await runFishingConfigWizard(true);
    return;
  }

  autoCalibrateRoiForScreen();

  console.log("====================================================================");
  console.log("  Bot Unificado (Pesca + Macros/Autoclicker) — Roblox / Sessão RDP  ");
  console.log("====================================================================");
  console.log(
    `- Template Pesca     : ${path.basename(CONFIG.vision.templatePath)} (${fishTemplate.width}x${fishTemplate.height}px)`
  );
  console.log(
    `- ROI configurada    : x=${CONFIG.roi.x}, y=${CONFIG.roi.y}, w=${CONFIG.roi.width}, h=${CONFIG.roi.height} (Limiar: ${(CONFIG.vision.threshold * 100).toFixed(0)}%)`
  );
  console.log(
    `- Tempos Pesca       : Lançar=${CONFIG.timings.castHoldMs}ms | Clique=${CONFIG.timings.clickPressMs}ms/${CONFIG.timings.clickReleaseMs}ms | Captura=${CONFIG.timings.captureDurationMs}ms | Coleta=${CONFIG.timings.cooldownMs}ms`
  );
  console.log(
    `- Troca na Hotbar    : ${CONFIG.hotbar.enabled ? `ATIVADA (Tecla [${CONFIG.hotbar.resetSlotKey}] -> [${CONFIG.hotbar.rodSlotKey}])` : "DESATIVADA"}`
  );
  const activeProfile = macroEngine.getCurrentProfile();
  console.log(
    `- Macro Perfil Atual : #${macroEngine.getCurrentIndex() + 1} ${activeProfile.nome} | Mouse: ${macroEngine.formatMouse(activeProfile)} | Teclas: ${macroEngine.formatSequence(activeProfile.teclas)}`
  );

  if (conflictNotices.length > 0) {
    console.log("");
    for (const notice of conflictNotices) {
      console.warn(
        `[ATALHOS] Conflito resolvido em "${notice.action}": "${notice.requested}" -> "${notice.assigned}" (${notice.reason})`
      );
    }
  }

  runScreenshotSelfTest();

  hotkeyManager.start();
  printHotkeysTable();

  console.log('Digite "ajuda" para ver todos os comandos (Pesca, Macros, Perfis e Atalhos).');
  showPrompt();
}

void main();
