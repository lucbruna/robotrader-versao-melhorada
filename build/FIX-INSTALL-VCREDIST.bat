@echo off
REM Instala Microsoft Visual C++ Redistributable 2015-2022 (x64) silenciosamente
REM Resolver o problema mais comum: app Electron nao abre sem VC++

echo Baixando Microsoft Visual C++ Redistributable 2015-2022 (x64)...
echo.

powershell -Command ^
  "try { ^
     Invoke-WebRequest -Uri 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile '%TEMP%\vc_redist.x64.exe' -UseBasicParsing; ^
     Write-Host 'Download OK' ^
   } catch { ^
     Write-Host ('ERRO no download: ' + $_.Exception.Message); ^
     exit 1 ^
   }"

if not exist "%TEMP%\vc_redist.x64.exe" (
    echo.
    echo Falha no download. Verifique sua conexao de internet.
    pause
    exit /b 1
)

echo.
echo Instalando VC++ Redistributable (silencioso)...
echo Espere 30-60 segundos.
echo.

"%TEMP%\vc_redist.x64.exe" /install /passive /norestart
set RC=%ERRORLEVEL%

del "%TEMP%\vc_redist.x64.exe" >nul 2>&1

echo.
if %RC% EQU 0 (
    echo SUCESSO - VC++ Redistributable instalado.
    echo Agora tente abrir o RoboTrader AI novamente.
) else if %RC% EQU 3010 (
    echo SUCESSO - VC++ Redistributable instalado (requer reinicializacao).
    echo Reinicie o PC e tente abrir o RoboTrader AI novamente.
) else (
    echo AVISO - Instalador retornou codigo %RC%.
    echo Se voce ja tinha instalado, ignore esta mensagem.
)
echo.
pause
