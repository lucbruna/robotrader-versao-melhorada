// Electron main process — wraps the Vite-built web app as a desktop executable.
// Sensitive operations (AI signal, env vars) live here, not in the renderer.

const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  Menu,
  dialog,
} = require("electron");
const path = require("path");
const fs = require("fs");

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const VITE_DEV_SERVER_URL =
  process.env.VITE_DEV_SERVER_URL || "http://localhost:5173";

// ---- Crash-safe startup logging ----
// Writes to %APPDATA%/RoboTrader AI/logs/startup.log so we can diagnose
// "app não abre" reports after the fact.
function getLogDir() {
  try {
    const dir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return app.getPath("userData");
  }
}
function logStartup(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(" ")}\n`;
  try {
    fs.appendFileSync(path.join(getLogDir(), "startup.log"), line);
  } catch {
    /* noop */
  }
  if (isDev) console.log(line.trim());
}

// Capture very-early crashes BEFORE app object exists
const EARLY_LOG = path.join(
  process.env.APPDATA || process.cwd(),
  "RoboTrader AI",
  "logs",
  "startup.log",
);
try {
  fs.mkdirSync(path.dirname(EARLY_LOG), { recursive: true });
  fs.appendFileSync(
    EARLY_LOG,
    `[${new Date().toISOString()}] [pre-app] node=${process.versions.node} electron=${process.versions.electron} chrome=${process.versions.chrome} platform=${process.platform}\n`,
  );
} catch {
  /* noop */
}

// Enable Chromium's own logs to disk — captures GPU/V8/Sandbox issues that
// happen before our Node code can run.
app.commandLine.appendSwitch("enable-logging");
app.commandLine.appendSwitch("v", "1");

process.on("uncaughtException", (err) => {
  logStartup("UNCAUGHT", err?.stack || String(err));
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showErrorBox(
      "RoboTrader AI — erro inesperado",
      `${err?.message || err}\n\nLog: ${path.join(getLogDir(), "startup.log")}`,
    );
  }
});
process.on("unhandledRejection", (reason) => {
  logStartup("UNHANDLED_REJECTION", String(reason));
});

// Single-instance lock — second launch focuses the existing window
// instead of opening a new one (prevents file-lock and port clashes).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// Proper Windows app id (notifications, taskbar pinning, Start menu)
app.setAppUserModelId("com.robotrader.ai");

logStartup(
  "boot",
  "platform=",
  process.platform,
  "arch=",
  process.arch,
  "pid=",
  process.pid,
);

// Resolve where the renderer build is.
// In production electron-builder copies dist/client into resources/app/dist/client
function getRendererIndex() {
  if (isDev) return VITE_DEV_SERVER_URL;
  // dist/client/index.html
  const candidates = [
    path.join(__dirname, "..", "dist", "client", "index.html"),
    path.join(
      process.resourcesPath || "",
      "app",
      "dist",
      "client",
      "index.html",
    ),
    path.join(__dirname, "dist", "client", "index.html"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return "file://" + p.replace(/\\/g, "/");
    } catch {
      /* noop */
    }
  }
  return candidates[0];
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: "#0b0e13",
    title: "RoboTrader AI",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload uses Node modules
    },
  });

  // Renderer crash diagnostics — common cause of "app não abre"
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    logStartup("RENDER_GONE", JSON.stringify(details));
    dialog.showErrorBox(
      "RoboTrader AI — renderizador caiu",
      `Motivo: ${details.reason}\nExit code: ${details.exitCode}\n\nLog salvo em ${path.join(getLogDir(), "startup.log")}`,
    );
  });
  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logStartup("DID_FAIL_LOAD", code, desc, url);
  });
  mainWindow.webContents.on("preload-error", (_e, preloadPath, err) => {
    logStartup("PRELOAD_ERROR", preloadPath, err?.stack || String(err));
  });

  const target = getRendererIndex();
  logStartup("loadURL", target);
  if (isDev) {
    mainWindow.loadURL(target);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadURL(target);
  }

  mainWindow.once("ready-to-show", () => {
    logStartup("ready-to-show");
    mainWindow?.show();
  });

  // Open external links in the OS browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.on("gpu-process-crashed", (_e, killed) => {
  logStartup("GPU_CRASHED", "killed=", killed);
});
app.on("child-process-gone", (_e, details) => {
  logStartup("CHILD_GONE", JSON.stringify(details));
});

// ---- IPC: AI signal ----
// Mirrors src/lib/ai-signal.functions.ts but runs in the main process so the
// LOVABLE_API_KEY is never exposed to the renderer.
ipcMain.handle("ai:getSignal", async (_event, input) => {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return synthesize(input, {
      action: "HOLD",
      confidence: 0,
      rationale:
        "IA indisponível (LOVABLE_API_KEY não configurada). Defina a variável de ambiente antes de abrir o app.",
      risk: "HIGH",
      regime: "RANGE",
    });
  }

  const system = `Você é um trader quantitativo sênior de cripto com 15 anos de experiência. Analise o contexto técnico e de mercado fornecido e retorne SOMENTE JSON válido.

SAÍDA OBRIGATÓRIA (apenas este JSON, sem markdown):
{
  "action": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "confidence": 0-100,
  "entry": number,
  "stopLoss": number,
  "takeProfit": number,
  "rationale": "explicação curta em português (max 240 chars)",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "regime": "TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE" | "BREAKOUT",
  "rMultiple": number (1.0-5.0),
  "invalidation": "condição que invalida o trade em pt-BR",
  "ttl": number (minutos sugeridos, 15-720)
}

REGRAS: 1) HOLD quando indicadores conflitam ou ADX<20. 2) SL sempre baseado em ATR (k=1.5 LOW, 2.0 HIGH, 2.5 EXTREME). 3) RR mínimo 1.5:1. 4) Suportes/resistências guiam o SL. 5) Estrutura dita direção (UP→BUY, DOWN→SELL, RANGE→HOLD). 6) VWAP confirma viés intraday. 7) Confidence < 50 = HOLD.`;

  const userMsg = formatPrompt(input);

  try {
    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
        }),
      },
    );

    if (res.status === 429) {
      return synthesize(input, {
        action: "HOLD",
        confidence: 0,
        rationale: "Limite de requisições atingido. Tente em instantes.",
        risk: "HIGH",
        regime: "RANGE",
      });
    }
    if (res.status === 402) {
      return synthesize(input, {
        action: "HOLD",
        confidence: 0,
        rationale: "Créditos de IA esgotados.",
        risk: "HIGH",
        regime: "RANGE",
      });
    }
    if (!res.ok) {
      return synthesize(input, {
        action: "HOLD",
        confidence: 0,
        rationale: `Erro IA ${res.status}`,
        risk: "HIGH",
        regime: "RANGE",
      });
    }

    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content ?? "{}";
    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch {
      return synthesize(input, {
        action: "HOLD",
        confidence: 0,
        rationale: "Resposta da IA inválida.",
        risk: "HIGH",
        regime: "RANGE",
      });
    }
    return validate(parsed, input);
  } catch (err) {
    console.error("AI signal error", err);
    return synthesize(input, {
      action: "HOLD",
      confidence: 0,
      rationale: "Falha ao consultar IA.",
      risk: "HIGH",
      regime: "RANGE",
    });
  }
});

// ---- helpers (mirror of src/lib/ai-signal.functions.ts) ----
function formatPrompt(d) {
  const fmt = (v, dp = 2) =>
    v === null || v === undefined ? "n/a" : Number(v).toFixed(dp);
  return [
    `ATIVO: ${d.symbol} (${d.interval})`,
    `PREÇO ATUAL: ${d.price}`,
    ``,
    `=== MERCADO 24H ===`,
    `Variação: ${Number(d.change24h).toFixed(2)}%`,
    `Range 24h: ${fmt(d.low24h)} - ${fmt(d.high24h)} | Posição no range: ${d.rangePos !== null && d.rangePos !== undefined ? (d.rangePos * 100).toFixed(0) + "%" : "n/a"}`,
    ``,
    `=== MOMENTUM ===`,
    `RSI(14): ${fmt(d.rsi, 1)}`,
    `MACD: ${fmt(d.macd, 4)} | Sinal: ${fmt(d.macdSignal, 4)} | Hist: ${fmt(d.macdHist, 4)}`,
    `Estocástico K/D: ${fmt(d.stochK, 1)} / ${fmt(d.stochD, 1)}`,
    ``,
    `=== TENDÊNCIA ===`,
    `EMA20: ${fmt(d.ema20)} | EMA50: ${fmt(d.ema50)} | EMA200: ${fmt(d.ema200)}`,
    `ADX: ${fmt(d.adx, 1)} | +DI: ${fmt(d.plusDI, 1)} | -DI: ${fmt(d.minusDI, 1)}`,
    `Estrutura: ${d.structure}`,
    ``,
    `=== VOLATILIDADE ===`,
    `ATR(14): ${fmt(d.atr, 4)} (${d.atrPct !== null && d.atrPct !== undefined ? (d.atrPct * 100).toFixed(2) + "%" : "n/a"} do preço)`,
    `Regime: ${d.volRegime}`,
    `Bollinger: ${fmt(d.bbLower)} - ${fmt(d.bbUpper)}`,
    ``,
    `=== VOLUME / FLUXO ===`,
    `VWAP: ${fmt(d.vwap)}`,
    `OBV slope: ${d.obvSlope === 1 ? "compra" : d.obvSlope === -1 ? "venda" : "neutro"}`,
    ``,
    `=== NÍVEIS CHAVE ===`,
    `Suportes: ${(d.supports || []).length ? d.supports.map((s) => Number(s).toFixed(2)).join(", ") : "nenhum próximo"}`,
    `Resistências: ${(d.resistances || []).length ? d.resistances.map((r) => Number(r).toFixed(2)).join(", ") : "nenhuma próxima"}`,
  ].join("\n");
}

function validate(parsed, data) {
  const atr = data.atr ?? data.price * 0.02;
  const k =
    data.volRegime === "EXTREME" ? 2.5 : data.volRegime === "HIGH" ? 2.0 : 1.5;
  const entry = Number(parsed.entry) || data.price;
  let stop = Number(parsed.stopLoss);
  if (!isFinite(stop) || stop <= 0) {
    stop = parsed.action === "BUY" ? entry - atr * k : entry + atr * k;
  }
  let target = Number(parsed.takeProfit);
  if (!isFinite(target) || target <= 0) {
    target =
      parsed.action === "BUY" ? entry + atr * k * 2 : entry - atr * k * 2;
  }
  if (parsed.action === "BUY" && stop >= entry) stop = entry - atr * k;
  if (parsed.action === "SELL" && stop <= entry) stop = entry + atr * k;
  if (parsed.action === "BUY" && target <= entry) target = entry + atr * k * 2;
  if (parsed.action === "SELL" && target >= entry) target = entry - atr * k * 2;

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rMultiple = risk > 0 ? reward / risk : 1;

  let confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
  if (data.volRegime === "EXTREME" && confidence > 70) confidence = 70;
  if (
    data.structure === "RANGE" &&
    (parsed.action === "BUY" || parsed.action === "SELL")
  ) {
    confidence = Math.min(confidence, 55);
  }

  const regime =
    parsed.regime === "TREND_UP" ||
    parsed.regime === "TREND_DOWN" ||
    parsed.regime === "RANGE" ||
    parsed.regime === "VOLATILE" ||
    parsed.regime === "BREAKOUT"
      ? parsed.regime
      : data.volRegime === "EXTREME" || data.volRegime === "HIGH"
        ? "VOLATILE"
        : data.structure === "UP"
          ? "TREND_UP"
          : data.structure === "DOWN"
            ? "TREND_DOWN"
            : "RANGE";

  let action = "HOLD";
  if (parsed.action === "BUY" || parsed.action === "SELL")
    action = parsed.action;
  else if (parsed.action === "CLOSE") action = "CLOSE";

  return {
    action,
    confidence,
    entry,
    stopLoss: stop,
    takeProfit: target,
    rationale: String(parsed.rationale || "Sem justificativa.").slice(0, 280),
    risk:
      parsed.risk === "LOW" || parsed.risk === "HIGH" ? parsed.risk : "MEDIUM",
    regime,
    rMultiple: Math.max(
      0.5,
      Math.min(5, Number(parsed.rMultiple) || rMultiple),
    ),
    invalidation: String(parsed.invalidation || "Stop loss atingido").slice(
      0,
      140,
    ),
    ttl: Math.max(15, Math.min(10080, Number(parsed.ttl) || 240)),
  };
}

function synthesize(data, base) {
  const atr = data.atr ?? data.price * 0.02;
  const k =
    data.volRegime === "EXTREME" ? 2.5 : data.volRegime === "HIGH" ? 2.0 : 1.5;
  let stop = data.price;
  let target = data.price;
  if (base.action === "BUY") {
    stop = data.price - atr * k;
    target = data.price + atr * k * 2;
  } else if (base.action === "SELL") {
    stop = data.price + atr * k;
    target = data.price - atr * k * 2;
  }
  return {
    ...base,
    entry: data.price,
    stopLoss: stop,
    takeProfit: target,
    rMultiple: k > 0 ? 2 / k : 1.5,
    invalidation: "Stop loss atingido",
    ttl: 240,
  };
}

// ---- IPC: Telegram ----
const TELEGRAM_API = "https://api.telegram.org/bot";
const TELEGRAM_MAX_MSG = 4096;
const TELEGRAM_MIN_INTERVAL_MS = 1100;

let telegramBucket = { last: 0, queue: Promise.resolve() };
const telegramStats = {
  totalSent: 0,
  totalFailed: 0,
  lastSendAt: 0,
  lastError: null,
};

function telegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  return { token, chatId };
}

function telegramStatus() {
  const b = telegramBot();
  return {
    configured: !!b,
    botTokenSet: !!process.env.TELEGRAM_BOT_TOKEN,
    chatIdSet: !!process.env.TELEGRAM_CHAT_ID,
    lastSendAt: telegramStats.lastSendAt || null,
    lastError: telegramStats.lastError,
    totalSent: telegramStats.totalSent,
    totalFailed: telegramStats.totalFailed,
  };
}

async function telegramRateLimit() {
  telegramBucket.queue = telegramBucket.queue.then(async () => {
    const now = Date.now();
    const wait = Math.max(
      0,
      TELEGRAM_MIN_INTERVAL_MS - (now - telegramBucket.last),
    );
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    telegramBucket.last = Date.now();
  });
  return telegramBucket.queue;
}

function telegramTruncate(text) {
  if (text.length <= TELEGRAM_MAX_MSG) return text;
  return text.slice(0, TELEGRAM_MAX_MSG - 20) + "\n\n…(truncado)";
}

async function telegramSend(text, opts = {}) {
  const b = telegramBot();
  if (!b) {
    return {
      ok: false,
      error: "Telegram não configurado (token/chat_id ausentes).",
      retryable: false,
    };
  }
  const body = telegramTruncate(String(text ?? ""));
  await telegramRateLimit();
  try {
    const res = await fetch(`${TELEGRAM_API}${b.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: b.chatId,
        text: body,
        parse_mode: opts.parseMode || "Markdown",
        disable_web_page_preview: opts.disableWebPreview !== false,
      }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) {
      const err = j.description || `HTTP ${res.status}`;
      telegramStats.totalFailed++;
      telegramStats.lastError = err;
      const retryable =
        res.status === 429 || (res.status >= 500 && res.status < 600);
      return { ok: false, error: err, retryable };
    }
    telegramStats.totalSent++;
    telegramStats.lastSendAt = Date.now();
    telegramStats.lastError = null;
    return {
      ok: true,
      messageId: j?.result?.message_id ?? 0,
      chatId: String(j?.result?.chat?.id ?? b.chatId),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    telegramStats.totalFailed++;
    telegramStats.lastError = msg;
    return { ok: false, error: msg, retryable: true };
  }
}

async function telegramTest() {
  const b = telegramBot();
  if (!b)
    return {
      ok: false,
      error: "TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_ID ausentes.",
    };
  try {
    const meRes = await fetch(`${TELEGRAM_API}${b.token}/getMe`);
    const meJ = await meRes.json();
    if (!meRes.ok || !meJ.ok) {
      return {
        ok: false,
        error: meJ.description || `getMe falhou (HTTP ${meRes.status})`,
      };
    }
    const botName = meJ.result?.first_name || "Bot";
    const botUsername = meJ.result?.username || "";
    const send = await telegramSend(
      `✅ *RoboTrader AI conectado*\nBot: ${botName} (@${botUsername})\nChat ID: \`${b.chatId}\`\nTimestamp: ${new Date().toISOString()}`,
    );
    if (!send.ok) return { ok: false, error: send.error };
    return { ok: true, botName, botUsername, chatId: b.chatId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// Mirrors of src/lib/telegram-helpers.ts (formatters used when renderer
// pre-formats are not present — kept simple and self-contained here).
function fmtPrice(n) {
  if (!isFinite(Number(n))) return "n/a";
  const v = Number(n);
  const abs = Math.abs(v);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return v.toFixed(dp);
}
function fmtPct(n) {
  const v = Number(n);
  if (!isFinite(v)) return "n/a";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}
function fmtTtl(min) {
  const m = Number(min);
  if (!isFinite(m) || m <= 0) return "n/a";
  if (m < 60) return `${Math.round(m)}min`;
  if (m < 1440) return `${(m / 60).toFixed(1)}h`;
  return `${(m / 1440).toFixed(1)}d`;
}
function regimeLabel(r) {
  return (
    {
      TREND_UP: "Tendência Alta",
      TREND_DOWN: "Tendência Baixa",
      RANGE: "Lateral",
      VOLATILE: "Volátil",
      BREAKOUT: "Rompimento",
    }[r] || String(r)
  );
}
const ACTION_EMOJI = { BUY: "🟢", SELL: "🔴", HOLD: "⚪", CLOSE: "🟡" };
const ACTION_LABEL = {
  BUY: "COMPRAR",
  SELL: "VENDER",
  HOLD: "AGUARDAR",
  CLOSE: "FECHAR",
};
const RISK_EMOJI = { LOW: "🟢", MEDIUM: "🟡", HIGH: "🔴" };

function formatSignalForTelegram(s, symbol, interval, extra) {
  extra = extra || {};
  const lines = [];
  const a = s.action;
  lines.push(
    `${ACTION_EMOJI[a] || "•"} *${ACTION_LABEL[a] || a}* — \`${symbol}\` (${interval})`,
  );
  lines.push("");
  lines.push(`💯 *Confiança:* ${Number(s.confidence) || 0}/100`);
  lines.push(`${RISK_EMOJI[s.risk] || "•"} *Risco:* ${s.risk}`);
  lines.push(`📊 *Regime:* ${regimeLabel(s.regime)}`);
  if (extra.currentPrice !== undefined)
    lines.push(`💰 *Preço atual:* ${fmtPrice(extra.currentPrice)}`);
  if (extra.change24h !== undefined)
    lines.push(`📈 *24h:* ${fmtPct(extra.change24h)}`);
  if (a === "BUY" || a === "SELL") {
    lines.push("");
    lines.push(`🎯 *Entrada:* ${fmtPrice(s.entry)}`);
    lines.push(`🛑 *Stop:* ${fmtPrice(s.stopLoss)}`);
    lines.push(`🚀 *Alvo:* ${fmtPrice(s.takeProfit)}`);
    lines.push(`⚖️ *R:R:* 1:${Number(s.rMultiple || 0).toFixed(2)}`);
    lines.push(`⏱️ *TTL:* ${fmtTtl(s.ttl)}`);
  }
  if (s.rationale) {
    lines.push("");
    lines.push(`💬 _${String(s.rationale).slice(0, 280)}_`);
  }
  if (s.invalidation) {
    lines.push(`⚠️ _Invalidação:_ ${String(s.invalidation).slice(0, 140)}`);
  }
  lines.push("");
  lines.push(`_🤖 RoboTrader AI · ${new Date().toLocaleString("pt-BR")}_`);
  return lines.join("\n");
}

function formatAlertForTelegram(event) {
  const priorityIcon =
    event.priority === "URGENT"
      ? "🚨"
      : event.priority === "HIGH"
        ? "🔔"
        : event.priority === "MEDIUM"
          ? "ℹ️"
          : "📌";
  const typeIcon =
    event.type === "PRICE"
      ? "💰"
      : event.type === "TECHNICAL"
        ? "📊"
        : event.type === "AI_SIGNAL"
          ? "🤖"
          : event.type === "VOLUME"
            ? "📦"
            : "⏰";
  return [
    `${priorityIcon} *Alerta ${event.priority}* — \`${event.symbol}\``,
    `${typeIcon} ${event.type}: ${event.message}`,
    ``,
    `_🕐 ${new Date(event.timestamp).toLocaleString("pt-BR")}_`,
  ].join("\n");
}

ipcMain.handle("telegram:status", async () => telegramStatus());

ipcMain.handle("telegram:send", async (_e, payload) => {
  const text = typeof payload === "string" ? payload : payload?.text;
  const parseMode = payload?.parseMode ?? "Markdown";
  return telegramSend(text, { parseMode });
});

ipcMain.handle("telegram:sendSignal", async (_e, args) => {
  try {
    const msg = formatSignalForTelegram(
      args.signal,
      args.symbol,
      args.interval,
      args.extra || {},
    );
    return telegramSend(msg);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }
});

ipcMain.handle("telegram:sendAlert", async (_e, event) => {
  try {
    return telegramSend(formatAlertForTelegram(event));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      retryable: false,
    };
  }
});

ipcMain.handle("telegram:test", async () => telegramTest());

// ---- IPC: Auto-updater ----
// Uses electron-updater to check GitHub Releases for new versions.
// Only active in production builds (skipped in dev).
const { autoUpdater } = require("electron-updater");

const updaterState = {
  available: null, // { version, releaseDate, releaseNotes } | null
  downloaded: null, // { version, releaseDate } | null
  checking: false,
  downloading: false,
  progress: 0, // 0..1
  lastCheckAt: 0,
  lastError: null,
  currentVersion: app.getVersion(),
};

function emitUpdater(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(`updater:${channel}`, payload);
  }
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.logger = null; // silence logs unless debugging

autoUpdater.on("checking-for-update", () => {
  updaterState.checking = true;
  updaterState.lastError = null;
  emitUpdater("checking", { currentVersion: updaterState.currentVersion });
});

autoUpdater.on("update-available", (info) => {
  updaterState.checking = false;
  updaterState.downloading = true;
  updaterState.available = {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: info.releaseNotes,
  };
  emitUpdater("available", updaterState.available);
});

autoUpdater.on("download-progress", (p) => {
  updaterState.progress = p.percent ? p.percent / 100 : 0;
  emitUpdater("progress", { percent: updaterState.progress * 100 });
});

autoUpdater.on("update-downloaded", (info) => {
  updaterState.downloading = false;
  updaterState.progress = 1;
  updaterState.downloaded = {
    version: info.version,
    releaseDate: info.releaseDate,
  };
  emitUpdater("downloaded", updaterState.downloaded);
});

autoUpdater.on("update-not-available", () => {
  updaterState.checking = false;
  updaterState.lastCheckAt = Date.now();
  emitUpdater("not-available", { currentVersion: updaterState.currentVersion });
});

autoUpdater.on("error", (err) => {
  updaterState.checking = false;
  updaterState.downloading = false;
  updaterState.lastError = err instanceof Error ? err.message : String(err);
  emitUpdater("error", { error: updaterState.lastError });
});

ipcMain.handle("updater:status", async () => ({
  ...updaterState,
  enabled: !isDev,
  supportsAutoUpdate: true,
}));

ipcMain.handle("updater:check", async () => {
  if (isDev) {
    return { ok: false, error: "Auto-update desativado em modo dev." };
  }
  try {
    updaterState.checking = true;
    updaterState.lastError = null;
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (err) {
    updaterState.checking = false;
    updaterState.lastError = err instanceof Error ? err.message : String(err);
    return { ok: false, error: updaterState.lastError };
  }
});

ipcMain.handle("updater:install", async () => {
  if (isDev) {
    return { ok: false, error: "Auto-update desativado em modo dev." };
  }
  if (!updaterState.downloaded) {
    return { ok: false, error: "Nenhum update baixado ainda." };
  }
  try {
    // Give the renderer a moment to acknowledge before quitting
    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
});

// ---- App lifecycle ----
app.whenReady().then(() => {
  logStartup("app ready");
  try {
    // Hide default menu in production
    if (!isDev) Menu.setApplicationMenu(null);
    createWindow();
    logStartup("window created");
  } catch (err) {
    logStartup("BOOT_FAIL", err?.stack || String(err));
    dialog.showErrorBox(
      "RoboTrader AI — falhou ao iniciar",
      `${err?.message || err}\n\nLog: ${path.join(getLogDir(), "startup.log")}`,
    );
    app.quit();
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Auto-check for updates shortly after launch (production only)
  if (!isDev) {
    setTimeout(() => {
      autoUpdater
        .checkForUpdates()
        .catch((e) =>
          logStartup("autoupdate-check-failed", e?.message || String(e)),
        );
    }, 5000);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Harden: block navigation to external URLs
app.on("web-contents-created", (_e, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (isDev && url.startsWith(VITE_DEV_SERVER_URL)) return;
    event.preventDefault();
    shell.openExternal(url);
  });
});
