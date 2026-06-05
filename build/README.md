# Build resources

Coloque aqui os ícones da aplicação:

- `icon.ico` — Windows (256x256 mínimo, recomendado 256x256 múltiplos)
- `icon.icns` — macOS
- `icon.png` — Linux (512x512)

Se ausentes, o electron-builder usa o ícone padrão do Electron.

Para gerar a partir de um PNG, você pode usar:
- https://www.icoconvert.com/
- ImageMagick: `magick convert icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico`

---

# Troubleshooting — "App não abre / dá erro"

A build Windows exige **VC++ Redistributable 2015-2022 (x64)**. Quase todos
os Windows 10/11 já têm — se faltar, o `.exe` falha em silêncio ou com
mensagens confusas ("Código de execução não pode prosseguir", "VCRUNTIME140.dll
não encontrado", etc.).

## 1. Instalar pré-requisito (uma vez)

Baixe e instale o **vc_redist.x64.exe** da Microsoft:
https://aka.ms/vs/17/release/vc_redist.x64.exe

Reinicie o PC após instalar.

## 2. Windows SmartScreen (assinatura)

A build **não é code-signed** (precisa de certificado EV/OV pago). Ao abrir
o `.exe` pela primeira vez:

- **Setup (NSIS):** aparece a tela azul "Windows protegeu seu PC" →
  clique em "Mais informações" → "Executar mesmo assim".
- **Portable:** o Windows pode quarentena o arquivo em
  `C:\Users\<user>\AppData\Local\Temp`. Clique com botão direito →
  Propriedades → marque "Desbloquear" → OK → abra novamente.

## 3. Antivírus (falso positivo)

Electron não-assinado dispara heurística em Kaspersky, Avast, AVG, etc.
Se o `.exe` sumir após o download:

- Windows Defender: Histórico de proteção → Restaurar
- Avast/AVG: Configurações → Exceções → adicionar pasta
- Kaspersky: Ameaças detectadas → permitir

## 4. Como ver o erro real

Se o app não abre sem mensagem, rode pelo terminal para ver o stack:

```powershell
cd "C:\Program Files\RoboTrader AI"
.\RoboTrader\ AI.exe
```

Para a versão portable:

```powershell
cd <pasta onde extraiu>
.\RoboTrader\ AI-Portable-1.0.0-x64.exe
```

Saída típica de erro:
- `VCRUNTIME140.dll not found` → instale vc_redist (passo 1)
- `EBUSY: resource busy` → feche instâncias anteriores, cheque pasta `release\win-unpacked\resources\app.asar`
- `Cannot find module 'electron-updater'` → rebuildar (`npm run electron:build`)

## 5. Logs internos

O app grava tudo em:

```
%APPDATA%\RoboTrader AI\logs\startup.log
```

Abra esse arquivo — o último erro estará no final. Cole o conteúdo
ao reportar problema.

## 6. Versão recomendada para distribuir

Para usuários finais: **`RoboTrader AI-Setup-1.0.0-x64.exe`** (instalador NSIS)
em vez do Portable — lida melhor com permissões, path com espaços e
atualizações futuras (auto-updater só funciona no instalador).
