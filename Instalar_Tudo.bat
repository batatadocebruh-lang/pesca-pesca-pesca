@echo off
title Instalador Completo - Bot de Pesca Roblox
cd /d "%~dp0"

echo ============================================================
echo   Instalador Automatico - Bot de Pesca Roblox
echo ============================================================
echo.

node -v >nul 2>&1
if not errorlevel 1 goto :node_ok
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%PATH%;%ProgramFiles%\nodejs"
node -v >nul 2>&1
if not errorlevel 1 goto :node_ok
echo [ERRO] Node.js nao foi encontrado neste computador.
echo Por favor, instale o Node.js LTS em: https://nodejs.org/
echo Apos concluir a instalacao, execute este arquivo novamente.
echo.
pause
exit /b 1

:node_ok

echo [1/5] Instalando dependencias Node.js (npm install)...
call npm install
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar dependencias via "npm install".
    pause
    exit /b 1
)

echo.
echo [2/5] Compilando projeto TypeScript (npm run build)...
call npm run build
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao compilar o projeto via "npm run build".
    pause
    exit /b 1
)

echo.
echo [3/5] Configurando usuario BotUser, RDP Wrapper e credenciais locais...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_rdp_botuser.ps1"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao executar setup_rdp_botuser.ps1.
    pause
    exit /b 1
)

echo.
echo [4/5] Otimizando sistema, Roblox e limpeza automatica de RAM...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0otimizar_sistema_e_rdp.ps1"
if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao executar otimizar_sistema_e_rdp.ps1.
    pause
    exit /b 1
)

echo.
echo [5/5] Verificando deteccao visual (npm test)...
call npm test
if errorlevel 1 (
    echo.
    echo [ERRO] A verificacao visual via "npm test" falhou.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Tudo instalado e verificado com sucesso!
echo   - Abra a sessao RDP: Conectar_RDP_BotUser.bat
echo   - Inicie o bot dentro do RDP: Iniciar_Bot_Pesca.bat
echo ============================================================
echo.
pause
