@echo off
setlocal
set "DIR=%~dp0"
set "SRC=%DIR%RdpBotClient.cs"
set "EXE=%DIR%RdpBotClient.exe"
set "CSC=%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if not exist "%EXE%" goto :build
powershell -NoProfile -Command "if ((Get-Item -LiteralPath '%SRC%').LastWriteTimeUtc -gt (Get-Item -LiteralPath '%EXE%').LastWriteTimeUtc) { exit 1 } else { exit 0 }"
if errorlevel 1 goto :build
goto :run

:build
if not exist "%CSC%" (
    echo [ERRO] Compilador csc.exe nao encontrado em "%CSC%".
    pause
    exit /b 1
)
echo Compilando RdpBotClient.exe...
"%CSC%" /nologo /target:winexe /optimize+ /out:"%EXE%" "%SRC%" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:Microsoft.CSharp.dll /r:System.Core.dll
if errorlevel 1 (
    echo [ERRO] Falha ao compilar RdpBotClient.cs.
    pause
    exit /b 1
)

:run
start "" "%EXE%" %*
endlocal
