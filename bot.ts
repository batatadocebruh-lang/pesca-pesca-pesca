import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { execFile } from "child_process";
import { PNG } from "pngjs";
import { Hardware, GlobalHotkey, getAllWindows, sleep } from "keysender";

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
  // Região de Interesse (ROI): barra horizontal inferior do minigame (calibrada para 1440x900 e auto-ajustável para 1920x1080)
  roi: {
    x: 240,
    y: 630,
    width: 960,
    height: 220,
  },
  // Tempos do ciclo de automação e duração de cada tecla/clique (em milissegundos)
  timings: {
    castHoldMs: 950,           // Tempo segurando o botão esquerdo no lançamento (ajustado para não passar do Perfect)
    pollingIntervalMs: 35,     // Intervalo de leitura da ROI (30-50ms)
    biteTimeoutMs: 12000,      // Timeout de segurança (12s) caso a mordida falhe
    captureDurationMs: 2700,   // 2.7s de cliques contínuos na fase de captura
    clickPressMs: 25,          // Tempo com botão esquerdo pressionado por clique (~25ms = 20 CPS)
    clickReleaseMs: 25,        // Tempo com botão esquerdo solto após cada clique (~25ms = 20 CPS)
    postCaptureDelayMs: 1500,  // Espera após concluir os cliques de captura para encerrar a animação de coleta antes de trocar o slot
    keyPressMs: 100,           // Tempo pressionando as teclas de atalho (1 e 3)
    slotSwitchDelayMs: 500,    // Intervalo entre ativar a tecla 1 e a tecla 3
    postEquipDelayMs: 1200,    // Espera após ativar a tecla 3 para a vara terminar de equipar antes de clicar para lançar
    cooldownMs: 5000,          // (Legado) Tempo antigo de espera estática
  },
  // Teclas da Hotbar para garantir que a vara de pesca esteja equipada ao finalizar cada ciclo
  hotbar: {
    enabled: false,             // Permite ativar/desativar a troca de itens na hotbar (desativado por padrão)
    resetSlotKey: "1" as const, // Tecla 1: alterna para outro slot para limpar qualquer item segurado
    rodSlotKey: "3" as const,   // Tecla 3: slot onde a vara de pesca está localizada
  },
  // Configuração do Autoclicker na fase de captura
  autoclicker: {
    cps: 20, // 20 cliques por segundo (~54 cliques em 2.7s)
  },
  // Configuração de Detecção Visual (Template Matching Multi-Escala em buffer BGRA)
  vision: {
    templatePath: path.resolve(ROOT_DIR, "peixe_alvo.png"),
    barFramePath: path.resolve(ROOT_DIR, "moldura_barra.png"),
    stopButtonPath: path.resolve(ROOT_DIR, "botao_parar.png"),
    testScreenshotPath: path.resolve(ROOT_DIR, "nova_interface.png"),
    legacyScreenshotPath: path.resolve(ROOT_DIR, "Captura de tela 2026-10-29 233138.png"),
    threshold: 0.78,            // Limiar de similaridade (0.0 a 1.0) para confirmar o minigame/peixe
    useCardFrameFallback: true, // Detecta também pela moldura roxa/verde da barra e pelo botão PARAR (qualquer espécie de peixe)
    scales: [0.667, 0.711, 0.75, 0.8, 0.88, 1.0, 1.16, 1.345], // Suporta 960x600 (0.667), 1024x640 (0.711), 1080x675 (0.75), 1152x720 (0.8), 1440x900 (1.0), 1920x1080 (1.345)
    sampleStep: 4,              // Passo de amostragem dos pixels do template
    coarseStep: 4,              // Passo da busca inicial na ROI antes do refinamento fino
  },
  // Atalhos Globais
  hotkeys: {
    toggleStartPause: "f6" as const,
    exitProcess: "f7" as const,
    toggleHotbarSwitch: "f8" as const,
  },
};

/**
 * Carrega ajustes salvos do arquivo config.json (se existir).
 */
function loadSavedConfig(): void {
  if (!fs.existsSync(CONFIG_FILE_PATH)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, "utf-8"));
    if (raw.roi) Object.assign(CONFIG.roi, raw.roi);
    if (raw.timings) Object.assign(CONFIG.timings, raw.timings);
    if (raw.hotbar && typeof raw.hotbar.enabled === "boolean") {
      CONFIG.hotbar.enabled = raw.hotbar.enabled;
    }
    if (raw.autoclicker) Object.assign(CONFIG.autoclicker, raw.autoclicker);
    if (raw.vision) {
      if (typeof raw.vision.threshold === "number") CONFIG.vision.threshold = raw.vision.threshold;
      if (typeof raw.vision.useCardFrameFallback === "boolean") {
        CONFIG.vision.useCardFrameFallback = raw.vision.useCardFrameFallback;
      }
    }
  } catch (err) {
    console.warn("[AVISO] Não foi possível ler config.json, usando valores padrão.", err);
  }
}

/**
 * Salva as configurações atuais em config.json.
 */
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
  fullVariants: ScaledVariant[];  // Peixe novo exato (peixe_alvo.png) em múltiplas escalas
  frameVariants: ScaledVariant[]; // Moldura roxa/verde da barra e card (moldura_barra.png) - qualquer peixe
  stopVariants: ScaledVariant[];  // Botão vermelho PARAR (botao_parar.png) - invariante na interface
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

/**
 * Redimensiona um PNG via interpolação bilinear para preparar variantes multi-escala.
 */
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

/**
 * Constrói amostras ordenadas e intercaladas por contraste (pixels claros/neon e contornos escuros
 * primeiro) para permitir descarte rápido (early cutoff) em poucos pixels quando não há match.
 */
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

/**
 * Carrega os templates da nova interface:
 * 1) peixe_alvo.png (peixe radioativo roxo/verde da nova atualização)
 * 2) moldura_barra.png (moldura da barra roxa/verde ao redor do card, independente da espécie do peixe)
 * 3) botao_parar.png (botão vermelho PARAR à direita da barra)
 */
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

/**
 * Busca um conjunto de variantes multi-escala dentro de um buffer BGRA.
 */
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
    // Normalizador calibrado (380 por amostra) para rejeitar fundos roxos/alaranjados (<0.64) e destacar a UI real (>0.90)
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

/**
 * Executa Template Matching híbrido na nova interface:
 * 1) Peixe Exato (peixe_alvo.png)
 * 2) Moldura da Barra/Card (moldura_barra.png - detecta qualquer espécie de peixe na nova barra roxa/verde)
 * 3) Botão PARAR (botao_parar.png - detecta o botão vermelho PARAR ao lado da barra)
 */
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

/**
 * Verifica se o buffer capturado possui pixels válidos (não está totalmente preto/zerado).
 */
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
// INICIALIZAÇÃO DO HARDWARE E CONTROLE DE CAPTURA
// ============================================================================
// bot: vinculado à janela do Roblox para foco e envio de comandos
const bot = new Hardware(CONFIG.window.title);
// screenBot: captura direto do Desktop DWM (GetDC(NULL)) para evitar tela preta do DirectX 11 no GetDC(hWnd)
const screenBot = new Hardware();
const fishTemplate = loadTemplate(CONFIG.vision.templatePath);

/**
 * Verifica a resolução real da tela e ajusta automaticamente a ROI caso ultrapasse os limites
 * do monitor (ex: alternando entre 1440x900 e 1920x1080).
 */
function autoCalibrateRoiForScreen(): void {
  try {
    const fullDesktop = screenBot.workwindow.capture("bgra");
    if (!fullDesktop || !fullDesktop.width || !fullDesktop.height) return;

    const sw = fullDesktop.width;
    const sh = fullDesktop.height;
    const expectedX = Math.round(sw * 0.165);
    const expectedY = Math.round(sh * 0.70);
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

    // Prioriza a escala correspondente à altura da tela atual (base 900p) para economizar CPU
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

autoCalibrateRoiForScreen();

let isRunning = false;
let loopActive = false;

/**
 * Garante que o workwindow está vinculado à janela do Roblox.
 */
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

/**
 * Captura a ROI priorizando o buffer DWM da tela (screenBot) para compatibilidade com DirectX 11
 * do Roblox e coordenadas exatas de tela, com fallback automático para a captura da janela.
 */
function captureROI() {
  const deskCap = screenBot.workwindow.capture(CONFIG.roi, "bgra");
  if (deskCap && deskCap.data && isBufferNonEmpty(deskCap.data)) {
    return deskCap;
  }
  return bot.workwindow.capture(CONFIG.roi, "bgra");
}

// ============================================================================
// TESTE AUTOMÁTICO COM A CAPTURA DE TELA DA NOVA INTERFACE
// ============================================================================
function evaluatePngScreenshot(screenshotPath: string): boolean {
  if (!fs.existsSync(screenshotPath)) {
    console.log(`[TESTE] Arquivo de teste não encontrado: ${path.basename(screenshotPath)}`);
    return false;
  }

  const startMs = performance.now();
  const fullPng = PNG.sync.read(fs.readFileSync(screenshotPath));

  // Se a imagem já for um recorte da barra (ex: nova_interface.png 831x154), analisa a imagem inteira;
  // caso seja uma captura de tela cheia (ex: 1920x1080 ou 1440x900), extrai a ROI proporcional correspondente.
  const isCroppedBar = fullPng.height < 400;
  const rx = isCroppedBar ? 0 : Math.round(fullPng.width * 0.165);
  const ry = isCroppedBar ? 0 : Math.round(fullPng.height * 0.70);
  const rw = isCroppedBar ? fullPng.width : Math.min(fullPng.width - rx, Math.round(fullPng.width * 0.67));
  const rh = isCroppedBar ? fullPng.height : Math.min(fullPng.height - ry, Math.round(fullPng.height * 0.245));

  const roiBgra = Buffer.alloc(rw * rh * 4);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(fullPng.width - 1, rx + x);
      const sy = Math.min(fullPng.height - 1, ry + y);
      const srcIdx = (sy * fullPng.width + sx) * 4;
      const dstIdx = (y * rw + x) * 4;
      roiBgra[dstIdx] = fullPng.data[srcIdx + 2];     // B
      roiBgra[dstIdx + 1] = fullPng.data[srcIdx + 1]; // G
      roiBgra[dstIdx + 2] = fullPng.data[srcIdx];     // R
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

/**
 * Executa Garbage Collection no V8 para liberar rapidamente HBITMAPs (CreateDIBSection)
 * capturados pelo keysender e, opcionalmente, aciona trim_ram.ps1 a cada 20s.
 */
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

/**
 * Passo 2: Polling da ROI em formato BGRA procurando o ícone do peixe.
 */
async function waitForFishInROI(): Promise<{ match: MatchResult | null; maxScoreSeen: number; validCapture: boolean }> {
  const startTime = Date.now();
  let maxScoreSeen = 0;
  let validCapture = false;
  let pollCount = 0;

  while (isRunning && Date.now() - startTime < CONFIG.timings.biteTimeoutMs) {
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

/**
 * Passo 3: Autoclicker na fase de captura usando os tempos configurados (clickPressMs / clickReleaseMs).
 */
async function performCaptureClicks(): Promise<number> {
  const pressMs = Math.max(1, CONFIG.timings.clickPressMs);
  const releaseMs = Math.max(1, CONFIG.timings.clickReleaseMs);
  const cycleMs = pressMs + releaseMs;
  const targetClicks = Math.max(1, Math.round(CONFIG.timings.captureDurationMs / cycleMs));

  const startTime = Date.now();
  let clicks = 0;

  while (
    isRunning &&
    clicks < targetClicks &&
    Date.now() - startTime < CONFIG.timings.captureDurationMs
  ) {
    await bot.mouse.click("left", pressMs, releaseMs);
    clicks++;
  }

  return clicks;
}

/**
 * Passo 4: Garante que a vara de pesca está sendo utilizada ao finalizar o ciclo.
 * Aguarda o término da animação de captura, ativa a tecla 1 e depois a tecla 3
 * (onde está a vara de pesca) e aguarda a animação de equipar a vara concluir antes de lançar novamente.
 */
async function ensureFishingRodEquipped(cycleCount: number, isTimeout = false): Promise<void> {
  if (!isRunning) return;

  // Garante que o botão esquerdo do mouse esteja totalmente solto antes de trocar de slot
  await bot.mouse.toggle("left", false).catch(() => {});

  const preDelay = isTimeout ? 300 : CONFIG.timings.postCaptureDelayMs;
  console.log(
    `[CICLO #${cycleCount}] 4/4 Aguardando ${preDelay}ms pós-captura e trocando slots: tecla [${CONFIG.hotbar.resetSlotKey}] -> tecla [${CONFIG.hotbar.rodSlotKey}]...`
  );

  await sleep(preDelay);
  if (!isRunning) return;

  await bot.keyboard.sendKey(
    CONFIG.hotbar.resetSlotKey,
    CONFIG.timings.keyPressMs,
    CONFIG.timings.slotSwitchDelayMs
  );
  if (!isRunning) return;

  await bot.keyboard.sendKey(
    CONFIG.hotbar.rodSlotKey,
    CONFIG.timings.keyPressMs,
    CONFIG.timings.postEquipDelayMs
  );
}

/**
 * Loop principal do ciclo de pesca.
 */
async function runFishingLoop(): Promise<void> {
  if (loopActive) return;
  loopActive = true;

  let cycleCount = 0;

  try {
    while (isRunning) {
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

      // Passo 1: Lançamento da Linha (garante estado solto antes de pressionar para o Roblox registrar a borda de subida do clique)
      await bot.mouse.toggle("left", false).catch(() => {});
      await sleep(60);
      await bot.mouse.toggle("left", true);
      await sleep(CONFIG.timings.castHoldMs);
      await bot.mouse.toggle("left", false);

      if (!isRunning) break;

      // Passo 2: Detecção Visual (Polling da ROI)
      console.log(
        `[CICLO #${cycleCount}] 2/4 Monitorando ROI (${CONFIG.roi.x}, ${CONFIG.roi.y}, ${CONFIG.roi.width}x${CONFIG.roi.height}) [timeout: ${CONFIG.timings.biteTimeoutMs}ms]...`
      );
      const { match, maxScoreSeen, validCapture } = await waitForFishInROI();

      if (!isRunning) break;

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

      // Passo 3: Fase de Captura (Autoclicker)
      const effectiveCps = (1000 / (CONFIG.timings.clickPressMs + CONFIG.timings.clickReleaseMs)).toFixed(1);
      console.log(
        `[CICLO #${cycleCount}] 3/4 Capturando (~${effectiveCps} CPS [${CONFIG.timings.clickPressMs}ms press / ${CONFIG.timings.clickReleaseMs}ms solto] por ${CONFIG.timings.captureDurationMs}ms)...`
      );
      const clicksExecuted = await performCaptureClicks();
      console.log(`[CICLO #${cycleCount}] Fase de captura concluída (${clicksExecuted} cliques).`);

      if (!isRunning) break;

      // Passo 4: Troca de itens na hotbar (se ativada) ou aguarda o resfriamento/coleta normal
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
    console.error("[ERRO] Falha durante o ciclo de automação:", err);
    isRunning = false;
  } finally {
    await bot.mouse.toggle("left", false).catch(() => {});
    loopActive = false;
  }
}

// ============================================================================
// COMANDO INTERATIVO `config` PARA AJUSTAR TEMPOS DE CADA TECLA/AÇÃO
// ============================================================================
function printCurrentConfig(): void {
  const effectiveCps = (1000 / (CONFIG.timings.clickPressMs + CONFIG.timings.clickReleaseMs)).toFixed(1);
  const hotbarStatus = CONFIG.hotbar.enabled
    ? `ATIVADA (Tecla [${CONFIG.hotbar.resetSlotKey}] -> Tecla [${CONFIG.hotbar.rodSlotKey}])`
    : "DESATIVADA (Apenas espera cooldown)";
  console.log("\n================ CONFIGURAÇÃO ATUAL ================");
  console.log(`  cast      (Tempo segurando clique no lançamento) : ${CONFIG.timings.castHoldMs} ms`);
  console.log(`  press     (Tempo pressionado em cada clique)     : ${CONFIG.timings.clickPressMs} ms`);
  console.log(`  release   (Tempo solto entre cada clique)        : ${CONFIG.timings.clickReleaseMs} ms (~${effectiveCps} CPS)`);
  console.log(`  capture   (Duração total da fase de captura)     : ${CONFIG.timings.captureDurationMs} ms`);
  console.log(`  cooldown  (Tempo de espera/coleta no final)      : ${CONFIG.timings.cooldownMs} ms`);
  console.log(`  hotbar    (Troca de itens na hotbar [F8])        : ${hotbarStatus}`);
  console.log(`  timeout   (Timeout esperando o peixe morder)     : ${CONFIG.timings.biteTimeoutMs} ms`);
  console.log(`  polling   (Intervalo de verificação da ROI)      : ${CONFIG.timings.pollingIntervalMs} ms`);
  console.log(`  threshold (Sensibilidade visual 0.50 a 0.99)     : ${CONFIG.vision.threshold}`);
  console.log("====================================================");
  console.log("Dica: Digite 'config' para o assistente passo a passo,");
  console.log("      'hotbar' (ou pressione [F8]) para ativar/desativar a troca de itens na hotbar,");
  console.log("      'config <chave> <valor>' (ex: config cast 850 | config hotbar on/off)");
  console.log("      ou 'test' para testar a detecção na imagem de captura.\n");
}

function applySingleConfigKey(key: string, rawVal: string): boolean {
  const cleanKey = key.toLowerCase();
  const cleanVal = rawVal.trim().toLowerCase();

  if (cleanKey === "hotbar" || cleanKey === "troca" || cleanKey === "slot") {
    if (["on", "true", "1", "sim", "s", "ativar", "ativo"].includes(cleanVal)) {
      CONFIG.hotbar.enabled = true;
    } else if (["off", "false", "0", "nao", "não", "n", "desativar", "inativo"].includes(cleanVal)) {
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
      `[CONFIG] Fase de troca de itens na hotbar (${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey}): ${CONFIG.hotbar.enabled ? "ATIVADA" : "DESATIVADA"}.`
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
    case "cps":
      CONFIG.autoclicker.cps = Math.max(1, Math.round(val));
      const half = Math.max(1, Math.round(1000 / (CONFIG.autoclicker.cps * 2)));
      CONFIG.timings.clickPressMs = half;
      CONFIG.timings.clickReleaseMs = half;
      console.log(`[CONFIG] Taxa ajustada para ${CONFIG.autoclicker.cps} CPS (${half}ms pressionado / ${half}ms solto).`);
      break;
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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, (ans) => resolve(ans.trim())));
}

async function runInteractiveConfigWizard(exitAfter = false): Promise<void> {
  const wasRunning = isRunning;
  if (isRunning) {
    isRunning = false;
    await bot.mouse.toggle("left", false).catch(() => {});
    console.log("[CONFIG] Automação pausada temporariamente para ajuste de configuração.");
  }

  console.log("\n=== ASSISTENTE DE CONFIGURAÇÃO DE TEMPOS (Pressione ENTER para manter o atual) ===");

  const castAns = await askQuestion(
    `1. Tempo segurando o clique no lançamento [atual: ${CONFIG.timings.castHoldMs}ms]: `
  );
  if (castAns) applySingleConfigKey("cast", castAns);

  const pressAns = await askQuestion(
    `2. Tempo do clique PRESSIONADO na captura [atual: ${CONFIG.timings.clickPressMs}ms]: `
  );
  if (pressAns) applySingleConfigKey("press", pressAns);

  const releaseAns = await askQuestion(
    `3. Tempo do clique SOLTO na captura [atual: ${CONFIG.timings.clickReleaseMs}ms]: `
  );
  if (releaseAns) applySingleConfigKey("release", releaseAns);

  const captureAns = await askQuestion(
    `4. Duração total da fase de captura [atual: ${CONFIG.timings.captureDurationMs}ms]: `
  );
  if (captureAns) applySingleConfigKey("capture", captureAns);

  const cooldownAns = await askQuestion(
    `5. Tempo de espera/coleta após captura [atual: ${CONFIG.timings.cooldownMs}ms]: `
  );
  if (cooldownAns) applySingleConfigKey("cooldown", cooldownAns);

  const hotbarAns = await askQuestion(
    `6. Ativar troca de itens na hotbar (tecla ${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey})? (sim/nao) [atual: ${CONFIG.hotbar.enabled ? "sim" : "nao"}]: `
  );
  if (hotbarAns) applySingleConfigKey("hotbar", hotbarAns);

  const timeoutAns = await askQuestion(
    `7. Timeout esperando peixe morder [atual: ${CONFIG.timings.biteTimeoutMs}ms]: `
  );
  if (timeoutAns) applySingleConfigKey("timeout", timeoutAns);

  const thresholdAns = await askQuestion(
    `8. Limiar de sensibilidade visual (0.50 a 0.99) [atual: ${CONFIG.vision.threshold}]: `
  );
  if (thresholdAns) applySingleConfigKey("threshold", thresholdAns);

  saveConfig();
  console.log("[CONFIG] Configurações salvas com sucesso em config.json!");
  printCurrentConfig();

  if (exitAfter) {
    GlobalHotkey.deleteAll();
    rl.close();
    process.exit(0);
  } else if (wasRunning) {
    console.log("[CONFIG] Pressione [F6] quando quiser retomar a automação.");
  }
}

rl.on("line", async (line) => {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (!cmd) return;

  if (cmd === "config") {
    if (parts.length === 1) {
      await runInteractiveConfigWizard(false);
    } else if (parts.length >= 3) {
      applySingleConfigKey(parts[1], parts[2]);
    } else if (parts.length === 2 && parts[1].toLowerCase() === "hotbar") {
      applySingleConfigKey("hotbar", "toggle");
    } else {
      printCurrentConfig();
    }
  } else if (cmd === "hotbar") {
    applySingleConfigKey("hotbar", parts[1] ?? "toggle");
  } else if (cmd === "test") {
    runScreenshotSelfTest();
  } else if (cmd === "help" || cmd === "ajuda") {
    printCurrentConfig();
  }
});

// ============================================================================
// REGISTRO DE HOTKEYS GLOBAIS (F6, F7 e F8)
// ============================================================================
new GlobalHotkey({
  key: CONFIG.hotkeys.toggleStartPause,
  mode: "once",
  async action() {
    isRunning = !isRunning;
    if (isRunning) {
      console.log("\n==========================================");
      console.log(" [F6] AUTOMAÇÃO INICIADA");
      console.log("==========================================");
      void runFishingLoop();
    } else {
      console.log("\n==========================================");
      console.log(" [F6] AUTOMAÇÃO PAUSADA");
      console.log("==========================================");
      await bot.mouse.toggle("left", false).catch(() => {});
    }
  },
});

new GlobalHotkey({
  key: CONFIG.hotkeys.exitProcess,
  mode: "once",
  async action() {
    console.log("\n==========================================");
    console.log(" [F7] ENCERRANDO PROCESSO...");
    console.log("==========================================");
    isRunning = false;
    await bot.mouse.toggle("left", false).catch(() => {});
    GlobalHotkey.deleteAll();
    rl.close();
    process.exit(0);
  },
});

new GlobalHotkey({
  key: CONFIG.hotkeys.toggleHotbarSwitch,
  mode: "once",
  action() {
    CONFIG.hotbar.enabled = !CONFIG.hotbar.enabled;
    saveConfig();
    console.log(
      `\n[F8] Troca de itens na hotbar (${CONFIG.hotbar.resetSlotKey} -> ${CONFIG.hotbar.rodSlotKey}): ${CONFIG.hotbar.enabled ? "ATIVADA" : "DESATIVADA"}`
    );
  },
});

// ============================================================================
// EXECUÇÃO INICIAL / CLI ARGS
// ============================================================================
async function main(): Promise<void> {
  const cliArg = process.argv[2]?.toLowerCase();

  if (cliArg === "test") {
    const ok = runScreenshotSelfTest();
    GlobalHotkey.deleteAll();
    rl.close();
    process.exit(ok ? 0 : 1);
  }

  if (cliArg === "config") {
    printCurrentConfig();
    if (process.argv[3] && process.argv[4]) {
      applySingleConfigKey(process.argv[3], process.argv[4]);
      GlobalHotkey.deleteAll();
      rl.close();
      process.exit(0);
    }
    await runInteractiveConfigWizard(true);
    return;
  }

  console.log("==========================================================");
  console.log(" Bot de Pesca Roblox - keysender + Template Matching BGRA");
  console.log("==========================================================");
  console.log(
    `- Template carregado : ${path.basename(CONFIG.vision.templatePath)} (${fishTemplate.width}x${fishTemplate.height}px)`
  );
  console.log(
    `- ROI configurada    : x=${CONFIG.roi.x}, y=${CONFIG.roi.y}, w=${CONFIG.roi.width}, h=${CONFIG.roi.height}`
  );
  console.log(
    `- Limiar visual      : ${(CONFIG.vision.threshold * 100).toFixed(0)}% (Detecção híbrida: Peixe Exato + Moldura do Card)`
  );
  console.log(
    `- Tempos atuais      : Lançar=${CONFIG.timings.castHoldMs}ms | Clique=${CONFIG.timings.clickPressMs}ms/${CONFIG.timings.clickReleaseMs}ms | Captura=${CONFIG.timings.captureDurationMs}ms | Coleta=${CONFIG.timings.cooldownMs}ms`
  );
  console.log(
    `- Troca na Hotbar    : ${CONFIG.hotbar.enabled ? `ATIVADA (Tecla [${CONFIG.hotbar.resetSlotKey}] -> [${CONFIG.hotbar.rodSlotKey}])` : "DESATIVADA (Pressione [F8] ou digite 'hotbar' para reativar)"}`
  );

  // Executa auto-teste na imagem da nova interface ao iniciar
  runScreenshotSelfTest();

  console.log(" Controles Globais e Comandos de Terminal:");
  console.log("  [F6] Iniciar / Pausar o ciclo de automação");
  console.log("  [F7] Encerrar o script de forma limpa");
  console.log("  [F8] Ativar / Desativar a troca de itens na hotbar (tecla 1 -> 3)");
  console.log("  Digite 'hotbar' (ou 'config hotbar on/off') no terminal para alternar a troca de itens,");
  console.log("  ou 'config' para ajustar os tempos de cada tecla/clique.");
  console.log("==========================================================");
}

void main();
