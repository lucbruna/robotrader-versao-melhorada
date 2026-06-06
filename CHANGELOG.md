# Changelog

All notable changes to RoboTrader AI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-05

### Added
- **#14 LLM Explainer**: Botão "Explicar com IA" no painel de sinal. Gera explicação em 2-4 frases PT-BR sobre o racional técnico do sinal, com cache por `action|score|confidence|regime|aiAction`. Fallback determinístico local quando a API falha.
- **#15 Context Injection (Confluence + Regime)**: O prompt da IA agora inclui seções opcionais `=== CONFLUENCE ===` e `=== REGIME DE MERCADO ===`. Modificadores de confiança aplicados PROGRAMATICAMENTE em `validateAndEnrich`: +10 quando alinha com confluence forte, 0 (kill) quando opõe, cap 60 em VOLATILE, cap 50 em regime nascente (≤2 barras), cap 40 contra-tendência estabelecida (≥4 barras). Novos hooks `useConfluence` e `useRegimeLive`.
- **#16 Consensus Mode**: Toggle `IA | Consenso` no header do painel. Chama 3 modelos em paralelo (gemini-flash 1.0, gemini-pro 1.4, llama-70b 1.0) via `Promise.allSettled`. Voto ponderado por confidence; labels `UNANIME` (100%) / `MAIORIA` (≥67%) / `DIVIDIDO` (<67%); safety net: DIVIDIDO com agreement <60% em ação não-HOLD → downgrade para HOLD (cap 40). UI expansível com breakdown por modelo.
- **#17 UI Polish**: Animações `rt-fade-in` (220ms), `rt-fade-in-fast` (160ms), `rt-shimmer` em `src/styles.css`. Componentes `<Skeleton />` e `<FadeIn />` em `src/components/ui/animated.tsx`. Suporte a `prefers-reduced-motion`. Aplicado em dashboard (chart + indicators re-animam em troca de symbol/interval).
- **#18 Toasts (sonner)**: Notificações bottom-right em trade execute (success/info) e envio de Telegram (success/error). Toaster montado em `__root.tsx`.
- **#19 Keyboard Shortcuts**: 10 atalhos globais: `?` (help), `Esc` (fechar), `g+d` (dashboard), `g+b` (backtest), `g+s` (scanner), `g+j` (journal), `r` (refresh), `shift+r` (execute), `t` (telegram), `c` (toggle consensus). Ignora inputs/textareas/contentEditable. Modal de ajuda com `KeyboardShortcutsButton` no header.
- **#20 Performance**: `React.memo` aplicado em `AISignalPanel` (reduz re-renders em tick de ticker e updates de snapshot).
- **#21 Tests (vitest 2.x)**: 18 testes em 3 arquivos cobrindo `position-sizer` (6), `confluence` (6) e `regime` (6). Config em `vitest.config.ts`; scripts `npm run test` e `npm run test:watch`. 100% pass rate.

### Fixed
- **OOH .exe (1/2)**: `electron-updater` movido de `devDependencies` → `dependencies`. electron-builder não inclui devDeps no asar; `require("electron-updater")` em runtime falhava silenciosamente e o app fechava ao iniciar. Log em `%APPDATA%/RoboTrader AI/logs/startup.log`.
- **OOH .exe (2/2)**: `IndicatorsPanel.tsx` Stat component — ícones lucide são `forwardRef` objects, não funções. Renderizar via JSX `<Icon className="..." />`, nunca via chamada `Icon(...)`.
- **CRLF em CI**: `.gitattributes` força `* text=auto eol=lf` + `actions/checkout@v4` com `autocrlf: false` em `.github/workflows/ci.yml` (cinto-e-suspensórios contra warnings `Delete ␍`).
- **React refresh warnings**: Componente `AISignalPanel` movido para `AISignalPanelMemo` export com `React.memo` wrap.

### Technical
- Server functions em TanStack Start (`getAISignal`, `explainSignal`, `getAIConsensus`) espelhadas em `electron/main.cjs` IPC handlers.
- Novo `src/lib/hooks/useSymbolContext.ts` com 5 fetches paralelos para `useConfluence`.
- Novo `src/lib/hooks/useKeyboardShortcuts.ts` (keySignature builder, ignora alvos editáveis).
- Novo `src/components/ui/animated.tsx` (`Skeleton` + `FadeIn` com prop `fast`).
- Novo `src/components/ui/keyboard-shortcuts.tsx` (button + modal).
- Novo `src/styles.css` (keyframes + classes + media query reduced-motion).
- `package.json`: `electron-updater` em `dependencies`; `vitest@^2.0.0` em `devDependencies`; scripts `test` e `test:watch`.

## [1.0.0] - 2026-05-XX

### Added
- Initial release: Backtest, Walk-Forward, Monte Carlo, Confluence, Regime, Scanner, Position Sizer, Journal.
- Electron desktop app (Windows .exe via NSIS + portable).
- TanStack Start SSR (Cloudflare Workers).
- Binance Futures data integration.
- Telegram notifications.
- Local signal engine (`localSignal`).
- AI signal mode (single model: gemini-3-flash-preview).
