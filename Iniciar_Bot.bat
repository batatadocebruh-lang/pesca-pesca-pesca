@echo off
title Bot Unificado (Pesca + Macros) - Roblox (Sessao RDP)
set "PATH=%PATH%;C:\Program Files\nodejs"
if exist "C:\pesca\package.json" (
    cd /d "C:\pesca"
) else (
    cd /d "%~dp0"
)
if exist "C:\pesca\trim_ram.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "C:\pesca\trim_ram.ps1" >nul 2>&1
) else if exist "%~dp0trim_ram.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0trim_ram.ps1" >nul 2>&1
)
if not exist "node_modules\uiohook-napi\package.json" (
    echo Instalando dependencias pendentes ^(uiohook-napi^)...
    call npm install
    if errorlevel 1 (
        echo Falha ao instalar dependencias Node.js.
        pause >nul
        exit /b 1
    )
)
echo Compilando e iniciando Bot Unificado (Pesca + Macros) em %CD%...
call npx tsc
if errorlevel 1 (
    echo Falha ao compilar TypeScript.
    pause >nul
    exit /b 1
)
node --expose-gc --max-old-space-size=96 dist\bot.js
echo.
echo O bot foi encerrado. Pressione qualquer tecla para fechar esta janela.
pause >nul
