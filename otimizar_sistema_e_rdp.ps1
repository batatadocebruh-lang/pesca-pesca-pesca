<#
.SYNOPSIS
    Otimizacao extrema de RAM e desempenho para o bot de pesca no Roblox + Sessao RDP.
    Corrige o vazamento de memoria do mstsc.exe (H.264/DXVA), encerra bloatware,
    otimiza configuracoes graficas do Roblox e agenda limpeza automatica de RAM.
#>

$ErrorActionPreference = "Continue"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Solicitando elevacao de Administrador..."
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs -Wait -PassThru
    exit $proc.ExitCode
}

$logPath = Join-Path $env:TEMP "otimizar_sistema_e_rdp.log"
Start-Transcript -Path $logPath -Force | Out-Null

function Set-RegistryValue {
    param(
        [string]$Path,
        [string]$Name,
        $Value,
        [Microsoft.Win32.RegistryValueKind]$Type = [Microsoft.Win32.RegistryValueKind]::DWord
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -Path $Path -Force | Out-Null
    }
    Set-ItemProperty -LiteralPath $Path -Name $Name -Value $Value -Type $Type -Force
}

function Set-RegistryDword {
    param(
        [string]$Path,
        [string]$Name,
        [int]$Value
    )
    Set-RegistryValue -Path $Path -Name $Name -Value $Value -Type DWord
}

function Set-BotUserVisualDebloat {
    $botUser = Get-LocalUser -Name "BotUser" -ErrorAction SilentlyContinue
    if (-not $botUser) {
        return
    }
    $sid = $botUser.SID.Value
    $hiveRoot = "Registry::HKEY_USERS\$sid"
    $tempMount = $false
    if (-not (Test-Path -LiteralPath $hiveRoot)) {
        $ntUserDat = "C:\Users\BotUser\NTUSER.DAT"
        if (-not (Test-Path -LiteralPath $ntUserDat)) {
            return
        }
        $tempKey = "HKU\BotUserDebloatTmp"
        & reg.exe load $tempKey $ntUserDat 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            return
        }
        $hiveRoot = "Registry::HKEY_USERS\BotUserDebloatTmp"
        $tempMount = $true
    }

    try {
        $mask = [byte[]](0x90, 0x12, 0x01, 0x80, 0x10, 0x00, 0x00, 0x00)
        $specs = @(
            @{ Sub = "Control Panel\Desktop"; Name = "WallPaper"; Val = ""; Type = "String" },
            @{ Sub = "Control Panel\Desktop"; Name = "WallpaperStyle"; Val = "0"; Type = "String" },
            @{ Sub = "Control Panel\Desktop"; Name = "DragFullWindows"; Val = "0"; Type = "String" },
            @{ Sub = "Control Panel\Desktop"; Name = "MenuShowDelay"; Val = "0"; Type = "String" },
            @{ Sub = "Control Panel\Desktop"; Name = "FontSmoothing"; Val = "0"; Type = "String" },
            @{ Sub = "Control Panel\Desktop"; Name = "UserPreferencesMask"; Val = $mask; Type = "Binary" },
            @{ Sub = "Control Panel\Desktop\WindowMetrics"; Name = "MinAnimate"; Val = "0"; Type = "String" },
            @{ Sub = "Control Panel\Colors"; Name = "Background"; Val = "0 0 0"; Type = "String" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\Explorer\VisualEffects"; Name = "VisualFXSetting"; Val = 2; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"; Name = "TaskbarAnimations"; Val = 0; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"; Name = "ListviewAlphaSelect"; Val = 0; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"; Name = "ListviewShadow"; Val = 0; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"; Name = "IconsOnly"; Val = 1; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"; Name = "EnableTransparency"; Val = 0; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"; Name = "RotatingLockScreenEnabled"; Val = 0; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"; Name = "RotatingLockScreenOverlayEnabled"; Val = 0; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager"; Name = "SubscribedContent-338387Enabled"; Val = 0; Type = "DWord" },
            @{ Sub = "Software\Microsoft\Windows\CurrentVersion\Explorer\HideDesktopIcons\NewStartPanel"; Name = "{2cc5ca98-6485-489a-920e-b3e88a6ccce3}"; Val = 1; Type = "DWord" }
        )
        foreach ($s in $specs) {
            $fullPath = "$hiveRoot\$($s.Sub)"
            Set-RegistryValue -Path $fullPath -Name $s.Name -Value $s.Val -Type ([Microsoft.Win32.RegistryValueKind]$s.Type)
        }
        $themesDir = "C:\Users\BotUser\AppData\Roaming\Microsoft\Windows\Themes"
        if (Test-Path -LiteralPath $themesDir) {
            Remove-Item -LiteralPath (Join-Path $themesDir "TranscodedWallpaper") -Force -ErrorAction SilentlyContinue
            Remove-Item -LiteralPath (Join-Path $themesDir "CachedFiles") -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-Host "Perfil visual do BotUser configurado em modo minimo (fundo preto, zero animacoes/Spotlight)."
    } finally {
        if ($tempMount) {
            [GC]::Collect()
            [GC]::WaitForPendingFinalizers()
            & reg.exe unload "HKU\BotUserDebloatTmp" 2>&1 | Out-Null
        }
    }
}

try {
    Write-Host "=== [1/5] Corrigindo vazamento de 3.4 GB no mstsc.exe e politicas RDP ==="
    $tsPolicy = "HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services"
    Set-RegistryDword -Path $tsPolicy -Name "bEnumerateHWBeforeSW" -Value 1
    Set-RegistryDword -Path $tsPolicy -Name "fEnableVirtualizedGraphics" -Value 0
    Set-RegistryDword -Path $tsPolicy -Name "AVC444ModePreferred" -Value 0
    Set-RegistryDword -Path $tsPolicy -Name "ImageQuality" -Value 5
    Set-RegistryDword -Path $tsPolicy -Name "ColorDepth" -Value 4
    Set-RegistryDword -Path $tsPolicy -Name "UserAuthentication" -Value 0
    Set-RegistryDword -Path $tsPolicy -Name "SecurityLayer" -Value 0
    Set-RegistryDword -Path $tsPolicy -Name "fNoFontNothing" -Value 1
    Set-RegistryDword -Path $tsPolicy -Name "fDisableWallpaper" -Value 1
    foreach ($extraKey in @(
        "AVCMixedModePreferred",
        "AVCHardwareEncodePreferred",
        "HEVCModePreferred",
        "MaxCompressionLevel",
        "fEnableRemoteFXAdvancedRemoteApp",
        "SelectTransport"
    )) {
        Remove-ItemProperty -Path $tsPolicy -Name $extraKey -ErrorAction SilentlyContinue
    }
    foreach ($subKey in @("H264Encoding", "ProgressiveEncoding")) {
        Remove-Item -Path "$tsPolicy\$subKey" -Recurse -Force -ErrorAction SilentlyContinue
    }

    $rdpTcp = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp"
    Set-RegistryDword -Path $rdpTcp -Name "UserAuthentication" -Value 0
    Set-RegistryDword -Path $rdpTcp -Name "SecurityLayer" -Value 0
    Set-RegistryDword -Path $rdpTcp -Name "ThrottlingDisabled" -Value 1
    Set-RegistryDword -Path $rdpTcp -Name "DWMFRAMEINTERVAL" -Value 33

    $winStations = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations"
    Set-RegistryDword -Path $winStations -Name "DWMFRAMEINTERVAL" -Value 33
    Set-RegistryDword -Path $winStations -Name "ThrottlingDisabled" -Value 1

    foreach ($wsPath in @($rdpTcp, $winStations)) {
        foreach ($prop in @("ProgressiveRefinementEnabled", "FixedQualityProgressive")) {
            Remove-ItemProperty -Path $wsPath -Name $prop -ErrorAction SilentlyContinue
        }
    }

    $clientPaths = @(
        "HKCU:\Software\Microsoft\Terminal Server Client",
        "HKLM:\SOFTWARE\Microsoft\Terminal Server Client",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Terminal Server Client"
    )
    $clientRemoveProps = @(
        "DisableWindowsPresentationFrameworkPipe",
        "DisableCodecCaps",
        "DisableH265HardwareDecode",
        "EnableH264MFDecode",
        "EnableH264CPUDecode",
        "EnableH265CPUDecode",
        "EnableHardwareMode",
        "EnableFrameBufferRedirection",
        "OffscreenSupportLevel",
        "OffscreenCacheSize",
        "OffscreenCacheEntries"
    )
    foreach ($cp in $clientPaths) {
        Set-RegistryDword -Path $cp -Name "RemoteDesktop_SuppressWhenMinimized" -Value 2
        Set-RegistryDword -Path $cp -Name "BitmapPersistCacheSize" -Value 0
        Set-RegistryDword -Path $cp -Name "DisableH264HardwareDecode" -Value 1
        foreach ($prop in $clientRemoveProps) {
            Remove-ItemProperty -Path $cp -Name $prop -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Politicas de RDP atualizadas (AVC mantido em software no cliente, efeitos visuais pesados desativados)."

    Write-Host "=== [2/5] Desativando bloatware e encerrando processos inuteis ==="
    Set-BotUserVisualDebloat
    Set-RegistryDword -Path "HKLM:\SOFTWARE\Policies\Microsoft\Edge" -Name "StartupBoostEnabled" -Value 0
    Set-RegistryDword -Path "HKLM:\SOFTWARE\Policies\Microsoft\Edge" -Name "BackgroundModeEnabled" -Value 0
    Set-RegistryDword -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Name "AllowGameDVR" -Value 0

    $allProcs = Get-Process -IncludeUserName -ErrorAction SilentlyContinue
    $botSessions = $allProcs | Where-Object { $_.UserName -like "*\BotUser" } | Select-Object -ExpandProperty SessionId -Unique
    $mainSessions = $allProcs | Where-Object {
        ($env:USERNAME -and ($_.UserName -like "*\$env:USERNAME") -and ($_.UserName -notlike "*\BotUser")) -or
        ($_.UserName -like "*\Usuario")
    } | Select-Object -ExpandProperty SessionId -Unique

    $botKillList = @(
        "msedge", "EdgeGameAssist", "WidgetBoard", "WidgetService",
        "OneDrive", "OneDrive.Sync.Service",
        "CrossDeviceResume", "MicrosoftStartFeedProvider", "IntelGraphicsSoftware",
        "SecurityHealthSystray", "UserOOBEBroker",
        "XboxGameBarWidgets", "GameBarFTServer"
    )
    if ($botSessions) {
        $killedBot = 0
        $allProcs | Where-Object { ($botSessions -contains $_.SessionId) -and ($botKillList -contains $_.ProcessName) } | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            $killedBot++
        }
        Write-Host "Encerrados $killedBot processos superfluos na sessao do BotUser (Sessao: $($botSessions -join ','))."
    }

    $mainKillList = @(
        "WidgetBoard", "WidgetService", "CrossDeviceService", "PhoneExperienceHost",
        "BixbySystray", "QuickShareCore", "EdgeGameAssist", "OneDrive.Sync.Service"
    )
    if ($mainSessions) {
        $killedMain = 0
        $allProcs | Where-Object { ($mainSessions -contains $_.SessionId) -and ($mainKillList -contains $_.ProcessName) } | ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            $killedMain++
        }
        Write-Host "Encerrados $killedMain processos superfluos na sessao principal."
    }

    $mstscProcs = Get-Process -Name "mstsc" -ErrorAction SilentlyContinue
    if ($mstscProcs) {
        Stop-Process -Name "mstsc" -Force -ErrorAction SilentlyContinue
        Write-Host "Processo mstsc.exe antigo encerrado para liberar RAM vazada (sessao BotUser preservada)."
    }

    Write-Host "=== [3/5] Otimizando Roblox (XML + ClientAppSettings + prioridade CPU) ==="
    $xmlCandidates = @("C:\Users\BotUser\AppData\Local\Roblox\GlobalBasicSettings_13.xml")
    if ($env:LOCALAPPDATA) {
        $xmlCandidates += (Join-Path $env:LOCALAPPDATA "Roblox\GlobalBasicSettings_13.xml")
    }
    if ($env:USERNAME) {
        $xmlCandidates += "C:\Users\$env:USERNAME\AppData\Local\Roblox\GlobalBasicSettings_13.xml"
    }
    $xmlCandidates += "C:\Users\Usuario\AppData\Local\Roblox\GlobalBasicSettings_13.xml"

    $seenXml = @{}
    $xmlFiles = foreach ($candidate in $xmlCandidates) {
        $norm = $candidate.ToLowerInvariant()
        if (-not $seenXml.ContainsKey($norm)) {
            $seenXml[$norm] = $true
            $candidate
        }
    }
    foreach ($xf in $xmlFiles) {
        if (Test-Path $xf) {
            $xmlContent = Get-Content -Path $xf -Raw -Encoding UTF8
            $xmlContent = [regex]::Replace($xmlContent, '<int name="GraphicsQualityLevel">[^<]*</int>', '<int name="GraphicsQualityLevel">1</int>')
            $xmlContent = [regex]::Replace($xmlContent, '<token name="SavedQualityLevel">[^<]*</token>', '<token name="SavedQualityLevel">1</token>')
            $xmlContent = [regex]::Replace($xmlContent, '<int name="QualityResetLevel">[^<]*</int>', '<int name="QualityResetLevel">1</int>')
            $xmlContent = [regex]::Replace($xmlContent, '<int name="FramerateCap">[^<]*</int>', '<int name="FramerateCap">30</int>')
            $xmlContent = [regex]::Replace($xmlContent, '<float name="MasterVolume">[^<]*</float>', '<float name="MasterVolume">0</float>')
            $xmlContent = [regex]::Replace($xmlContent, '<bool name="ReducedMotion">[^<]*</bool>', '<bool name="ReducedMotion">true</bool>')
            $xmlContent = [regex]::Replace($xmlContent, '<bool name="PlayerListVisible">[^<]*</bool>', '<bool name="PlayerListVisible">false</bool>')
            $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
            [System.IO.File]::WriteAllText($xf, $xmlContent, $utf8NoBom)
            Write-Host "GlobalBasicSettings_13.xml otimizado: $xf"
        }
    }

    $fflagsJson = @'
{
  "DFIntTaskSchedulerTargetFps": 30,
  "FFlagDisablePostFx": true,
  "FIntRenderShadowIntensity": 0,
  "DFIntDebugFRMQualityLevelOverride": 1,
  "FFlagGraphicsQualityOverrideEnabled": true,
  "FFlagEnableTelemetryService1": false,
  "FFlagEnableTelemetryProtocol": false
}
'@
    $versionGlobs = @(
        "C:\Users\*\AppData\Local\Roblox\Versions\version-*",
        "C:\Users\*\AppData\Local\Bloxstrap\Versions\version-*",
        "C:\Program Files (x86)\Roblox\Versions\version-*",
        "C:\Program Files\Roblox\Versions\version-*"
    )
    $utf8NoBom2 = New-Object System.Text.UTF8Encoding($false)
    foreach ($glob in $versionGlobs) {
        Get-Item $glob -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer } | ForEach-Object {
            $csDir = Join-Path $_.FullName "ClientSettings"
            if (-not (Test-Path $csDir)) { New-Item -ItemType Directory -Path $csDir -Force | Out-Null }
            $csFile = Join-Path $csDir "ClientAppSettings.json"
            [System.IO.File]::WriteAllText($csFile, $fflagsJson, $utf8NoBom2)
            Write-Host "ClientAppSettings.json aplicado em: $csFile"
        }
    }
    Get-Item "C:\Users\*\AppData\Local\Bloxstrap\Modifications" -ErrorAction SilentlyContinue | Where-Object { $_.PSIsContainer } | ForEach-Object {
        $modCsDir = Join-Path $_.FullName "ClientSettings"
        if (-not (Test-Path $modCsDir)) { New-Item -ItemType Directory -Path $modCsDir -Force | Out-Null }
        $modCsFile = Join-Path $modCsDir "ClientAppSettings.json"
        [System.IO.File]::WriteAllText($modCsFile, $fflagsJson, $utf8NoBom2)
        Write-Host "ClientAppSettings.json (Bloxstrap) aplicado em: $modCsFile"
    }

    Get-Process -Name "RobloxPlayerBeta" -ErrorAction SilentlyContinue | ForEach-Object {
        $_.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
        Write-Host "Prioridade de RobloxPlayerBeta (PID $($_.Id)) definida para BelowNormal."
    }

    Write-Host "=== [4/5] Atualizando atalho e agendando limpeza automatica de RAM ==="
    $pescaDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    if (Test-Path (Join-Path $pescaDir "Iniciar_Bot.bat")) {
        Copy-Item (Join-Path $pescaDir "Iniciar_Bot.bat") "C:\Users\Public\Desktop\Iniciar_Bot_Pesca.bat" -Force
    }

    $trimScript = "C:\pesca\trim_ram.ps1"
    if (-not (Test-Path $trimScript)) {
        $trimScript = Join-Path $pescaDir "trim_ram.ps1"
    }

    $taskName = "OtimizadorRAM_PescaBot"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$trimScript`" -All"
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Host "Tarefa agendada '$taskName' registrada (a cada 1 minuto como SYSTEM com -All)."

    Write-Host "=== [5/5] Executando expurgo de Working Set em todos os processos ==="
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $trimScript -All

    Start-Sleep -Seconds 1
    $osMem = Get-CimInstance Win32_OperatingSystem
    $freeGB = [math]::Round($osMem.FreePhysicalMemory / 1MB, 2)
    $totalGB = [math]::Round($osMem.TotalVisibleMemorySize / 1MB, 2)
    Write-Host ("Memoria apos otimizacao: Livre = {0} GB / Total = {1} GB" -f $freeGB, $totalGB)
}
finally {
    Stop-Transcript | Out-Null
}
