# RoboTrader AI

Robô de trading desktop para **Binance** com sinais técnicos locais, IA Gemini opcional, e risk engine institucional. Construído como app Electron (Windows) com React 19 + TanStack Router.

![Status](https://img.shields.io/badge/status-MVP--completo-brightgreen)
![Stack](https://img.shields.io/badge/stack-Electron%2033%20%2B%20React%2019%20%2B%20Vite%207-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

### Trading
- **WebSocket live** — order book + klines + ticker multi-stream com reconexão
- **Indicadores técnicos** — RSI, MACD, EMA 20/50/200, ATR, ADX, Bollinger, Stochastic, VWAP, OBV, structure, support/resistance
- **Sinal local** — heurística multi-fator (mean-reversion + trend-following)
- **IA opcional** — Gemini/Ollama com prompts estruturados (signal + explicação)
- **Risk engine** — position sizing ATR-aware, trailing stop, breakeven, R:R mínimo, kill-switches
- **Confluence score** — gauge 0-100 com 6 categorias ponderadas (trend/momentum/vol/volume/levels/derivatives)
- **Regime detector** — BULL_TREND / BEAR_TREND / RANGE / VOLATILE com histerese de 3 barras

### Mercados & dados
- **Funding + Open Interest** — premium index, OI histórico, long/short ratio, taker buy/sell, liquidações
- **Market scanner** — ranking multi-símbolo por opportunity score (signal + confluence + regime + volume)
- **Backtest engine** — replay de candles históricos com paginação Binance, equity curve, Sharpe, PF
- **Walk-Forward** — janelas rolantes IS/OOS com detecção de overfitting
- **Monte Carlo** — bootstrap de trades com bandas 5/50/95% e probabilidade de ruína
- **Position Sizer** — Kelly fracional + drawdown adjust + conviction + portfolio cap

### Integrações
- **Telegram** — alertas formatados com rate limiting
- **Auto-updater** — releases via GitHub Actions + `electron-updater`
- **Electron Builder** — installer NSIS + portable, com VC++ Redistributable embutido

## Stack

| Camada | Tecnologia |
|---|---|
| Shell | Electron 33 |
| UI | React 19 + Vite 7 + TanStack Router/Start |
| Estado | TanStack Query + hooks |
| Gráficos | Lightweight Charts |
| Backend | Cloudflare Workers (TanStack Start SSR) |
| AI | Gemini API / Ollama local |
| Dados | Binance Spot + Futures REST + WebSocket |
| Testes | ESLint + TypeScript strict |

## Quick start

```bash
# Instalar dependências
npm install

# Dev (Vite + Electron com hot-reload)
npm run electron:dev

# Build Windows installer + portable
npm run electron:build
# saída: release/RoboTrader AI-Setup-1.0.0-x64.exe
```

## Configuração

Variáveis de ambiente (opcionais, em `.env`):

```bash
TELEGRAM_BOT_TOKEN=...    # para alertas Telegram
TELEGRAM_CHAT_ID=...      # chat destino
GEMINI_API_KEY=...        # para IA Gemini
```

## Arquitetura

```
src/
├── lib/              # engines puros (sem React)
│   ├── indicators.ts # RSI, MACD, EMA, ATR, ADX, BB, structure, snapshot
│   ├── signal.ts     # (inlined in indicators.ts → localSignal)
│   ├── risk.ts       # ATR stops, position sizing, PnL
│   ├── confluence.ts # multi-factor 0-100 score
│   ├── regime.ts     # bull/bear/range/volatile + hysteresis
│   ├── backtest.ts   # engine de replay
│   ├── walk-forward.ts
│   ├── monte-carlo.ts
│   ├── position-sizer.ts
│   ├── scanner.ts    # multi-symbol
│   ├── binance.ts    # REST + tipos
│   ├── binance-ws.ts       # WebSocket spot
│   ├── binance-futures-ws.ts # WebSocket futures
│   ├── telegram.ts   # notifier
│   └── trading-api.ts
├── components/trading/  # UI panels
├── routes/
│   ├── index.tsx       # /         → dashboard
│   ├── backtest.tsx    # /backtest → backtest + WF + MC + Sizer Lab
│   └── scanner.tsx     # /scanner  → market scanner
└── styles.css

electron/
├── main.cjs    # BrowserWindow + IPC + startup logging
└── preload.cjs # context bridge
```

## Releases

Veja [RELEASE.md](./RELEASE.md) para o processo de build e publicação. CI/CD via `.github/workflows/release.yml` — push de tag `v*.*.*` gera build + GitHub Release automaticamente.

## Troubleshooting (Windows)

Se o `.exe` não abrir:

1. **VC++ Redistributable** — o instalador já embute, mas se falhar: instale manualmente de https://aka.ms/vs/17/release/vc_redist.x64.exe
2. **Logs** — `%APPDATA%\RoboTrader AI\logs\startup.log`
3. **Diagnose** — rode `build\diagnose.bat`

## License

MIT
