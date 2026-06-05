@echo off
REM Diagnostico RoboTrader AI - executa como Administrador
REM Verifica todos os pre-requisitos comuns do app e gera relatorio

setlocal enabledelayedexpansion
chcp 65001 >nul

set REPORT=%TEMP%\robotrader-diagnose-%RANDOM%.txt
echo Diagnostico RoboTrader AI - %DATE% %TIME% > "%REPORT%"
echo ============================================== >> "%REPORT%"

echo.
echo [1/6] Verificando Microsoft Visual C++ Redistributable 2015-2022...
echo --- VC++ Redistributable --- >> "%REPORT%"
reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" /v Installed >> "%REPORT%" 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   OK - VC++ Redistributable 64-bit instalado.
) else (
    echo   FALTA - VC++ Redistributable NAO encontrado!
    echo   SOLUCAO: execute "FIX-INSTALL-VCREDIST.bat" como Administrador.
    echo   Ou baixe de: https://aka.ms/vs/17/release/vc_redist.x64.exe
)
echo.

echo [2/6] Verificando WebView2 Runtime (usado por Electron)...
echo --- WebView2 Runtime --- >> "%REPORT%"
reg query "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" /v pv >> "%REPORT%" 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   OK - WebView2 Runtime presente.
) else (
    echo   FALTA - WebView2 Runtime NAO encontrado (raro em Win10 sem update).
    echo   SOLUCAO: baixe de https://developer.microsoft.com/microsoft-edge/webview2/
)
echo.

echo [3/6] Verificando .NET Framework (necessario para algumas DLLs do Windows)...
echo --- .NET Framework --- >> "%REPORT%"
reg query "HKLM\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full" /v Release >> "%REPORT%" 2>&1
if %ERRORLEVEL% EQU 0 (
    echo   OK - .NET Framework 4.x detectado.
) else (
    echo   AVISO - .NET Framework 4.x NAO detectado (geralmente OK no Win10+).
)
echo.

echo [4/6] Verificando logs de erro do RoboTrader AI...
set LOGFILE=%APPDATA%\RoboTrader AI\logs\startup.log
echo --- Startup log --- >> "%REPORT%"
if exist "%LOGFILE%" (
    echo   Log encontrado: %LOGFILE%
    echo. >> "%REPORT%"
    echo Ultimas 30 linhas: >> "%REPORT%"
    powershell -Command "Get-Content '%LOGFILE%' -Tail 30" >> "%REPORT%" 2>&1
    echo.
    echo   === Ultimas 30 linhas do log: ===
    powershell -Command "Get-Content '%LOGFILE%' -Tail 30"
) else (
    echo   NENHUM log encontrado em %LOGFILE%
    echo   Isso significa que o app nao chegou nem a executar main.cjs.
    echo   Causa provavel: VC++ Redistributable ausente ou Antivrus bloqueando.
)
echo.

echo [5/6] Verificando Antivirus em tempo real (Windows Defender)...
echo --- Windows Defender --- >> "%REPORT%"
powershell -Command "Get-MpPreference | Select-Object DisableRealtimeMonitoring" >> "%REPORT%" 2>&1
echo   (Se monitoramente em tempo real estiver ATIVO, ele pode estar
    bloqueando o .exe. Veja secao "Antivirus" em build\README.md)
echo.

echo [6/6] Verificando permissao de execucao na pasta instalada...
set INSTALL_DIR=%LOCALAPPDATA%\Programs\RoboTrader AI
echo --- Install dir --- >> "%REPORT%"
if exist "%INSTALL_DIR%\RoboTrader AI.exe" (
    echo   App instalado em: %INSTALL_DIR%
    echo   Permissao: >> "%REPORT%"
    icacls "%INSTALL_DIR%\RoboTrader AI.exe" >> "%REPORT%" 2>&1
    echo   Testando execucao direta (5 segundos)...
    echo.
    echo   Iniciando RoboTrader AI.exe em background (sera fechado em 5s)...
    start "" "%INSTALL_DIR%\RoboTrader AI.exe"
    timeout /t 5 /nobreak >nul
    taskkill /IM "RoboTrader AI.exe" /F >nul 2>&1
    echo   OK - processo foi iniciado (foi fechado pelo diagnostico).
) else (
    echo   AVISO - RoboTrader AI NAO esta instalado em %INSTALL_DIR%
    echo   Caminhos comuns: >> "%REPORT%"
    if exist "C:\Program Files\RoboTrader AI\RoboTrader AI.exe" (
        echo   Encontrado em: C:\Program Files\RoboTrader AI\ >> "%REPORT%"
    )
    if exist "%PROGRAMFILES%\RoboTrader AI\RoboTrader AI.exe" (
        echo   Encontrado em: %PROGRAMFILES%\RoboTrader AI\ >> "%REPORT%"
    )
)
echo.

echo ==============================================
echo Relatorio salvo em: %REPORT%
echo.
echo PROXIMOS PASSOS:
echo   1. Leia o relatorio acima.
echo   2. Se VC++ falta: rode FIX-INSTALL-VCREDIST.bat como Administrador.
echo   3. Se SmartScreen/AV: veja secao 2/3 do README.md em build/.
echo.
pause
