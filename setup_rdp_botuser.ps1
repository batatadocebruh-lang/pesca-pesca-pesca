<#
.SYNOPSIS
    Configura sessao RDP Local (RDP Wrapper) para o usuario BotUser,
    habilitando GPU de hardware e RemoteDesktop_SuppressWhenMinimized = 2.
#>

$ErrorActionPreference = "Stop"

# Auto-elevacao para Administrador
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Solicitando elevacao de Administrador..."
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs -Wait -PassThru
    exit $proc.ExitCode
}

$logPath = Join-Path $env:TEMP "setup_rdp_botuser.log"
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

function Update-RdpDomain {
    param(
        [string]$FilePath,
        [string]$ComputerName
    )
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        return
    }
    $item = Get-Item -LiteralPath $FilePath -Force
    $stripMask = [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::ReadOnly
    if ($item.Attributes -band $stripMask) {
        $item.Attributes = $item.Attributes -band (-bnot $stripMask)
    }

    $rawBytes = [System.IO.File]::ReadAllBytes($FilePath)
    if ($rawBytes.Length -ge 2 -and $rawBytes[0] -eq 0xFF -and $rawBytes[1] -eq 0xFE) {
        $enc = [System.Text.Encoding]::Unicode
    } elseif ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF) {
        $enc = New-Object System.Text.UTF8Encoding($true)
    } else {
        $enc = New-Object System.Text.UTF8Encoding($false)
    }

    $content = [System.IO.File]::ReadAllText($FilePath, $enc)
    if ($content -match "(?m)^domain:s:[^\r\n]*") {
        $updated = [regex]::Replace($content, "(?m)^domain:s:[^\r\n]*", "domain:s:$ComputerName")
    } else {
        $nl = if ($content -match "`r`n") { "`r`n" } else { "`n" }
        $updated = $content.TrimEnd("`r", "`n") + $nl + "domain:s:$ComputerName" + $nl
    }
    [System.IO.File]::WriteAllText($FilePath, $updated, $enc)
    Write-Host "Arquivo RDP atualizado com domain:s:${ComputerName}: $FilePath"
}

function Register-BotStartScheduledTask {
    param(
        [string]$TaskName = "IniciarBotPesca_BotUser",
        [string]$BotUserName = "BotUser",
        [string]$VbsPath = "C:\pesca\Iniciar_Bot_Minimizado.vbs",
        [string]$WorkingDirectory = "C:\pesca"
    )

    $botAccount = "$env:COMPUTERNAME\$BotUserName"
    $service = New-Object -ComObject "Schedule.Service"
    $service.Connect()

    $rootFolder = $service.GetFolder("\")
    $taskDef = $service.NewTask(0)
    $taskDef.RegistrationInfo.Description = "Inicia o Bot Unificado (Pesca + Macros) minimizado na barra de tarefas na sessao do $BotUserName."

    # Principal: BotUser, LogonType = 3 (TASK_LOGON_INTERACTIVE_TOKEN), RunLevel = 0 (LeastPrivilege)
    $taskDef.Principal.UserId = $botAccount
    $taskDef.Principal.LogonType = 3
    $taskDef.Principal.RunLevel = 0

    # Settings
    $taskDef.Settings.Enabled = $true
    $taskDef.Settings.AllowDemandStart = $true
    $taskDef.Settings.DisallowStartIfOnBatteries = $false
    $taskDef.Settings.StopIfGoingOnBatteries = $false
    $taskDef.Settings.MultipleInstances = 2   # TASK_INSTANCES_IGNORE_NEW
    $taskDef.Settings.ExecutionTimeLimit = "PT5M"

    # Trigger 1: LogonTrigger (Type = 9) para primeiro logon do BotUser
    $logonTrigger = $taskDef.Triggers.Create(9)
    $logonTrigger.Id = "LogonBotUser"
    $logonTrigger.UserId = $botAccount
    $logonTrigger.Enabled = $true

    # Trigger 2: SessionStateChangeTrigger (Type = 11, StateChange = 3 = TASK_SESSION_REMOTE_CONNECT)
    $rdpTrigger = $taskDef.Triggers.Create(11)
    $rdpTrigger.Id = "RemoteConnectBotUser"
    $rdpTrigger.StateChange = 3
    $rdpTrigger.UserId = $botAccount
    $rdpTrigger.Enabled = $true

    # Action: wscript.exe //B //Nologo "C:\pesca\Iniciar_Bot_Minimizado.vbs"
    $action = $taskDef.Actions.Create(0)
    $action.Path = "wscript.exe"
    $action.Arguments = "//B //Nologo `"$VbsPath`""
    $action.WorkingDirectory = $WorkingDirectory

    # 6 = TASK_CREATE_OR_UPDATE, 3 = TASK_LOGON_INTERACTIVE_TOKEN
    $rootFolder.RegisterTaskDefinition($TaskName, $taskDef, 6, $null, $null, 3) | Out-Null
    Write-Host "Tarefa agendada '$TaskName' configurada (Logon + RemoteConnect) para $botAccount."
}

try {
    Write-Host "=== [1/5] Configurando usuario BotUser e permissoes ==="
    $secPass = ConvertTo-SecureString "123" -AsPlainText -Force
    $existingUser = Get-LocalUser -Name "BotUser" -ErrorAction SilentlyContinue
    if ($existingUser) {
        Set-LocalUser -Name "BotUser" -Password $secPass -PasswordNeverExpires $true
        Enable-LocalUser -Name "BotUser"
        Write-Host "Usuario BotUser atualizado e habilitado."
    } else {
        New-LocalUser -Name "BotUser" -Password $secPass -FullName "BotUser" -PasswordNeverExpires -AccountNeverExpires | Out-Null
        Write-Host "Usuario BotUser criado."
    }

    $adminGroup = Get-LocalGroup -SID "S-1-5-32-544"
    $alreadyInAdmin = Get-LocalGroupMember -Group $adminGroup -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "*\BotUser" }
    if (-not $alreadyInAdmin) {
        Add-LocalGroupMember -Group $adminGroup -Member "BotUser" -ErrorAction Stop
        Write-Host "BotUser adicionado ao grupo $($adminGroup.Name)."
    } else {
        Write-Host "BotUser ja pertence ao grupo $($adminGroup.Name)."
    }

    $pescaTarget = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
    $pescaJunction = "C:\pesca"
    if ($pescaTarget.TrimEnd('\') -ieq $pescaJunction.TrimEnd('\')) {
        Write-Host "Pasta do bot ja esta localizada em $pescaJunction."
    } else {
        $existingJunction = Get-Item -Path $pescaJunction -Force -ErrorAction SilentlyContinue
        if (-not $existingJunction) {
            New-Item -ItemType Junction -Path $pescaJunction -Target $pescaTarget | Out-Null
            Write-Host "Juncao $pescaJunction -> $pescaTarget criada."
        } elseif ($existingJunction.LinkType -eq "Junction") {
            $currentTarget = ($existingJunction.Target | Select-Object -First 1)
            if ($currentTarget -and ($currentTarget.TrimEnd('\') -ieq $pescaTarget.TrimEnd('\'))) {
                Write-Host "Juncao $pescaJunction ja aponta para $pescaTarget."
            } else {
                [System.IO.Directory]::Delete($pescaJunction)
                New-Item -ItemType Junction -Path $pescaJunction -Target $pescaTarget | Out-Null
                Write-Host "Juncao $pescaJunction atualizada para $pescaTarget."
            }
        } else {
            Write-Host "Caminho $pescaJunction ja existe e nao e uma juncao."
        }
    }

    Write-Host "Concedendo permissoes NTFS para BotUser acessar a pasta do bot..."
    & icacls "$env:USERPROFILE" /grant "BotUser:(NP)(RX)" /Q | Out-Null
    $userDesktop = Join-Path $env:USERPROFILE "Desktop"
    if (Test-Path $userDesktop) {
        & icacls "$userDesktop" /grant "BotUser:(NP)(RX)" /Q | Out-Null
    }
    $parentCheck = Split-Path -Path $pescaTarget -Parent
    while ($parentCheck -and ($parentCheck.Length -gt $env:USERPROFILE.Length) -and ($parentCheck -like "$env:USERPROFILE\*")) {
        if (($parentCheck.TrimEnd('\') -ine $userDesktop.TrimEnd('\')) -and (Test-Path $parentCheck)) {
            & icacls "$parentCheck" /grant "BotUser:(NP)(RX)" /Q | Out-Null
        }
        $parentCheck = Split-Path -Path $parentCheck -Parent
    }
    & icacls $pescaTarget /grant "BotUser:(OI)(CI)F" /T /Q | Out-Null

    # Atalho do bot unificado (Pesca + Macros/Autoclicker) na Area de Trabalho do BotUser
    if (Test-Path (Join-Path $pescaTarget "Iniciar_Bot.bat")) {
        Copy-Item -Path (Join-Path $pescaTarget "Iniciar_Bot.bat") -Destination "C:\Users\Public\Desktop\Iniciar_Bot_Pesca.bat" -Force
        Write-Host "Atalho do bot unificado (Pesca + Macros) criado em C:\Users\Public\Desktop\Iniciar_Bot_Pesca.bat."
    }

    # Tarefa agendada para iniciar o bot minimizado na barra de tarefas ao logar/conectar no BotUser
    $vbsMinimizado = "C:\pesca\Iniciar_Bot_Minimizado.vbs"
    if (Test-Path -LiteralPath $vbsMinimizado) {
        & icacls $vbsMinimizado /grant "BotUser:F" /Q | Out-Null
    }
    Register-BotStartScheduledTask -VbsPath $vbsMinimizado -WorkingDirectory $pescaJunction

    # Atalho direto do cliente RDP nativo (Tela Cheia adaptativa + Mouse Relativo) na Area de Trabalho do usuario atual
    $conectarBat = Join-Path $pescaTarget "Conectar_RDP_BotUser.bat"
    $userDesktopDir = Join-Path $env:USERPROFILE "Desktop"
    if ((Test-Path -LiteralPath $conectarBat) -and (Test-Path -LiteralPath $userDesktopDir)) {
        try {
            $lnkPath = Join-Path $userDesktopDir "Conectar_RDP_BotUser.lnk"
            $wshShell = New-Object -ComObject WScript.Shell
            $shortcut = $wshShell.CreateShortcut($lnkPath)
            $shortcut.TargetPath = $conectarBat
            $shortcut.WorkingDirectory = $pescaTarget
            $shortcut.IconLocation = "$env:SystemRoot\System32\mstsc.exe,0"
            $shortcut.Description = "Conectar ao BotUser (960x600 internos, Tela Cheia adaptativa e Mouse Relativo)"
            $shortcut.Save()
            Write-Host "Atalho direto do cliente RDP criado em $lnkPath"
        } catch {
            Write-Host "Aviso: nao foi possivel criar Conectar_RDP_BotUser.lnk na Area de Trabalho ($($_.Exception.Message))."
        }
    }

    Write-Host "=== [2/5] Aplicando RemoteDesktop_SuppressWhenMinimized = 2 e cliente RDP enxuto ==="
    $suppressPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Terminal Server Client",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Terminal Server Client",
        "HKCU:\Software\Microsoft\Terminal Server Client"
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
        "OffscreenCacheEntries",
        "ForceDisableRelativeMouseMode"
    )
    foreach ($regPath in $suppressPaths) {
        Set-RegistryDword -Path $regPath -Name "RemoteDesktop_SuppressWhenMinimized" -Value 2
        Set-RegistryDword -Path $regPath -Name "BitmapPersistCacheSize" -Value 0
        Set-RegistryDword -Path $regPath -Name "DisableH264HardwareDecode" -Value 1
        foreach ($prop in $clientRemoveProps) {
            Remove-ItemProperty -Path $regPath -Name $prop -ErrorAction SilentlyContinue
        }
        Write-Host "Chaves do cliente RDP aplicadas em $regPath"
    }

    Write-Host "=== [3/5] Configurando politica de GPU de hardware para sessao RDP ==="
    $tsPolicyPath = "HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services"
    Set-RegistryDword -Path $tsPolicyPath -Name "bEnumerateHWBeforeSW" -Value 1
    Set-RegistryDword -Path $tsPolicyPath -Name "fEnableVirtualizedGraphics" -Value 0
    Set-RegistryDword -Path $tsPolicyPath -Name "AVC444ModePreferred" -Value 0
    Set-RegistryDword -Path $tsPolicyPath -Name "ImageQuality" -Value 5
    Set-RegistryDword -Path $tsPolicyPath -Name "ColorDepth" -Value 4
    Set-RegistryDword -Path $tsPolicyPath -Name "UserAuthentication" -Value 0
    Set-RegistryDword -Path $tsPolicyPath -Name "SecurityLayer" -Value 0
    Set-RegistryDword -Path $tsPolicyPath -Name "fNoFontNothing" -Value 1
    Set-RegistryDword -Path $tsPolicyPath -Name "fDisableWallpaper" -Value 1
    foreach ($extraKey in @(
        "AVCMixedModePreferred",
        "AVCHardwareEncodePreferred",
        "HEVCModePreferred",
        "MaxCompressionLevel",
        "fEnableRemoteFXAdvancedRemoteApp",
        "SelectTransport"
    )) {
        Remove-ItemProperty -Path $tsPolicyPath -Name $extraKey -ErrorAction SilentlyContinue
    }
    Set-BotUserVisualDebloat
    foreach ($subKey in @("H264Encoding", "ProgressiveEncoding")) {
        Remove-Item -Path "$tsPolicyPath\$subKey" -Recurse -Force -ErrorAction SilentlyContinue
    }
    $winStationsPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations"
    Set-RegistryDword -Path $winStationsPath -Name "DWMFRAMEINTERVAL" -Value 33
    Set-RegistryDword -Path $winStationsPath -Name "ThrottlingDisabled" -Value 1
    foreach ($prop in @("ProgressiveRefinementEnabled", "FixedQualityProgressive", "ForceDisableRdpRelativeMouse")) {
        Remove-ItemProperty -Path $winStationsPath -Name $prop -ErrorAction SilentlyContinue
    }
    Write-Host "Politicas de GPU e profundidade de cor (32-bit) aplicadas."

    Write-Host "=== [4/5] Configurando Terminal Server multi-sessao e Firewall ==="
    $tsControlPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server"
    Set-RegistryDword -Path $tsControlPath -Name "fDenyTSConnections" -Value 0
    Set-RegistryDword -Path $tsControlPath -Name "fSingleSessionPerUser" -Value 0

    $rdpTcpPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp"
    Set-RegistryDword -Path $rdpTcpPath -Name "UserAuthentication" -Value 0
    Set-RegistryDword -Path $rdpTcpPath -Name "SecurityLayer" -Value 0
    Set-RegistryDword -Path $rdpTcpPath -Name "ThrottlingDisabled" -Value 1
    Set-RegistryDword -Path $rdpTcpPath -Name "DWMFRAMEINTERVAL" -Value 33
    foreach ($prop in @("ProgressiveRefinementEnabled", "FixedQualityProgressive", "ForceDisableRdpRelativeMouse")) {
        Remove-ItemProperty -Path $rdpTcpPath -Name $prop -ErrorAction SilentlyContinue
    }

    if (-not (Get-NetFirewallRule -Name "RDPWrapper-TCP-3389" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name "RDPWrapper-TCP-3389" -DisplayName "RDP Local (TCP 3389)" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow -Profile Any | Out-Null
    }
    if (-not (Get-NetFirewallRule -Name "RDPWrapper-UDP-3389" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name "RDPWrapper-UDP-3389" -DisplayName "RDP Local (UDP 3389)" -Direction Inbound -Protocol UDP -LocalPort 3389 -Action Allow -Profile Any | Out-Null
    }
    Write-Host "Terminal Server e Firewall (TCP/UDP 3389) configurados."

    Write-Host "Configurando credencial local RDP e confianca para 127.0.0.2..."
    $rdpCredUser = "$env:COMPUTERNAME\BotUser"
    & cmdkey /generic:"TERMSRV/127.0.0.2" /user:"$rdpCredUser" /pass:"123" | Out-Null

    $serverHintPath = "HKCU:\Software\Microsoft\Terminal Server Client\Servers\127.0.0.2"
    if (-not (Test-Path $serverHintPath)) {
        New-Item -Path $serverHintPath -Force | Out-Null
    }
    Set-ItemProperty -Path $serverHintPath -Name "UsernameHint" -Value $rdpCredUser -Type String -Force

    $localDevicesPath = "HKCU:\Software\Microsoft\Terminal Server Client\LocalDevices"
    Set-RegistryDword -Path $localDevicesPath -Name "127.0.0.2" -Value 255
    Set-RegistryDword -Path $localDevicesPath -Name "127.0.0.2:3389" -Value 255

    $rdpFiles = @(
        (Join-Path $pescaTarget "Sessao_BotUser.rdp"),
        "$env:USERPROFILE\Documents\Default.rdp"
    )
    $myDocs = [Environment]::GetFolderPath("MyDocuments")
    if ($myDocs) {
        $rdpFiles += (Join-Path $myDocs "Default.rdp")
    }
    $seenRdp = @{}
    foreach ($rdpFile in $rdpFiles) {
        $normRdp = $rdpFile.ToLowerInvariant()
        if (-not $seenRdp.ContainsKey($normRdp)) {
            $seenRdp[$normRdp] = $true
            Update-RdpDomain -FilePath $rdpFile -ComputerName $env:COMPUTERNAME
        }
    }
    Write-Host "Credenciais e arquivos RDP configurados para $rdpCredUser."

    $tsVi = (Get-Item "C:\Windows\System32\termsrv.dll").VersionInfo
    $termsrvVer = "$($tsVi.FileMajorPart).$($tsVi.FileMinorPart).$($tsVi.FileBuildPart).$($tsVi.FilePrivatePart)"
    Write-Host "=== [5/5] Instalando e configurando RDP Wrapper (termsrv.dll $termsrvVer) ==="
    $rdpWrapDir = "C:\Program Files\RDP Wrapper"
    $extractDir = Join-Path $env:TEMP "RDPWrap-v1.6.2"
    Add-MpPreference -ExclusionPath $rdpWrapDir -ErrorAction SilentlyContinue
    Add-MpPreference -ExclusionPath $extractDir -ErrorAction SilentlyContinue
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

    $rdpWrapDll = Join-Path $rdpWrapDir "rdpwrap.dll"
    if (-not (Test-Path $rdpWrapDll)) {
        if (-not (Test-Path $extractDir)) {
            New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
        }
        $zipPath = Join-Path $extractDir "RDPWrap-v1.6.2.zip"
        if (-not (Test-Path $zipPath)) {
            Write-Host "Baixando RDPWrap-v1.6.2.zip..."
            Invoke-WebRequest -Uri "https://github.com/stascorp/rdpwrap/releases/download/v1.6.2/RDPWrap-v1.6.2.zip" -OutFile $zipPath -UseBasicParsing
        }
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
        Write-Host "Executando RDPWInst.exe -i..."
        $instProc = Start-Process -FilePath (Join-Path $extractDir "RDPWInst.exe") -ArgumentList "-i" -WorkingDirectory $extractDir -Wait -NoNewWindow -PassThru
        Write-Host "RDPWInst.exe finalizado com codigo $($instProc.ExitCode)."
    } else {
        Write-Host "rdpwrap.dll ja presente em $rdpWrapDir."
    }

    Write-Host "Parando TermService para atualizar rdpwrap.ini..."
    Stop-Service -Name "TermService" -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20; $i++) {
        $svc = Get-Service -Name "TermService" -ErrorAction SilentlyContinue
        if ($svc.Status -eq "Stopped") { break }
        Start-Sleep -Milliseconds 500
    }

    $iniSrc = Join-Path $env:TEMP "rdpwrap_latest.ini"
    $iniDst = Join-Path $rdpWrapDir "rdpwrap.ini"
    $iniDownloaded = $false
    try {
        Write-Host "Baixando rdpwrap.ini atualizado..."
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/sebaxakerhtc/rdpwrap.ini/master/rdpwrap.ini" -OutFile $iniSrc -UseBasicParsing -TimeoutSec 20
        $iniDownloaded = $true
    } catch {
        Write-Host "Aviso: falha ao baixar rdpwrap.ini online ($($_.Exception.Message)). Tentando cache local..."
    }

    $iniReadPath = $null
    if ($iniDownloaded -and (Test-Path $iniSrc)) {
        $iniReadPath = $iniSrc
    } elseif (Test-Path $iniSrc) {
        $iniReadPath = $iniSrc
    } elseif (Test-Path (Join-Path $env:TEMP "rdpwrap_check.ini")) {
        $iniReadPath = Join-Path $env:TEMP "rdpwrap_check.ini"
    } elseif (Test-Path $iniDst) {
        $iniReadPath = $iniDst
    } else {
        throw "Nao foi possivel baixar rdpwrap.ini e nenhuma copia em cache foi encontrada."
    }

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $iniText = [System.IO.File]::ReadAllText($iniReadPath, $utf8NoBom)

    if (($termsrvVer -eq "10.0.26100.9818") -and ($iniText -notmatch "(?m)^\[10\.0\.26100\.9818\]")) {
        $fallbackMain = @"
[10.0.26100.9818]
LocalOnlyPatch.x64=1
LocalOnlyOffset.x64=9FA61
LocalOnlyCode.x64=jmpshort
SingleUserPatch.x64=1
SingleUserOffset.x64=AC5DB
SingleUserCode.x64=mov_eax_1_nop_2
DefPolicyPatch.x64=1
DefPolicyOffset.x64=A977D
DefPolicyCode.x64=CDefPolicy_Query_r9d_rdi_jmp
SLInitHook.x64=1
SLInitOffset.x64=C0798
SLInitFunc.x64=New_CSLQuery_Initialize
"@ -replace "`r?`n", "`r`n"

        $fallbackSLInit = @"
[10.0.26100.9818-SLInit]
bInitialized.x64=135350
bServerSku.x64=135354
lMaxUserSessions.x64=135358
bAppServerAllowed.x64=135360
bRemoteConnAllowed.x64=13536C
bMultimonAllowed.x64=135370
ulMaxDebugSessions.x64=135378
bFUSEnabled.x64=13537C
"@ -replace "`r?`n", "`r`n"

        $iniText = $iniText.TrimEnd("`r", "`n") + "`r`n`r`n" + $fallbackMain + "`r`n`r`n" + $fallbackSLInit + "`r`n"
        Write-Host "Secao offline de fallback [10.0.26100.9818] adicionada ao rdpwrap.ini."
    }

    $hasSection = $iniText -match "(?m)^\[$([regex]::Escape($termsrvVer))\]"
    if ($hasSection) {
        Write-Host "Secao [$termsrvVer] encontrada no rdpwrap.ini."
    } else {
        Write-Host "AVISO: secao [$termsrvVer] NAO encontrada no rdpwrap.ini! O listener RDP pode nao iniciar."
    }

    [System.IO.File]::WriteAllText($iniDst, $iniText, $utf8NoBom)
    Write-Host "Arquivo $iniDst atualizado (versao alvo: $termsrvVer)."

    $termParamsPath = "HKLM:\SYSTEM\CurrentControlSet\Services\TermService\Parameters"
    Set-ItemProperty -Path $termParamsPath -Name "ServiceDll" -Value $rdpWrapDll -Type ExpandString -Force
    Write-Host "ServiceDll configurado para $rdpWrapDll"

    Set-Service -Name "TermService" -StartupType Automatic
    Start-Service -Name "TermService"

    $listening3389 = $false
    for ($i = 0; $i -lt 12; $i++) {
        Start-Sleep -Milliseconds 500
        $conns = Get-NetTCPConnection -LocalPort 3389 -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            $listening3389 = $true
            break
        }
    }

    $svcFinal = Get-Service -Name "TermService"
    Write-Host "TermService Status: $($svcFinal.Status) | StartType: $($svcFinal.StartType) | Porta 3389 em Listen: $listening3389"
}
finally {
    Stop-Transcript | Out-Null
}
