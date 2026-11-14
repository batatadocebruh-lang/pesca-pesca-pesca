param(
    [switch]$All
)

$ErrorActionPreference = "SilentlyContinue"

# Auto-elevação silenciosa para permitir expurgo/suspensão entre sessões (Sessão 1 e Sessão 2)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    $argList = @("-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($All) { $argList += "-All" }
    try {
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop
        exit $proc.ExitCode
    } catch {
        exit 0
    }
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class MemTrim {
    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("ntdll.dll", SetLastError = true)]
    public static extern int NtSuspendProcess(IntPtr processHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool SetProcessWorkingSetSizeEx(
        IntPtr hProcess,
        IntPtr dwMinimumWorkingSetSize,
        IntPtr dwMaximumWorkingSetSize,
        uint Flags
    );

    [DllImport("psapi.dll", SetLastError = true)]
    public static extern bool EmptyWorkingSet(IntPtr hProcess);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseHandle(IntPtr hObject);

    // PROCESS_QUERY_INFORMATION (0x0400) | PROCESS_SET_QUOTA (0x0100)
    public static bool TrimPid(int pid) {
        IntPtr hProc = OpenProcess(0x0500, false, pid);
        if (hProc == IntPtr.Zero) return false;
        try {
            bool ok1 = SetProcessWorkingSetSizeEx(hProc, (IntPtr)(-1), (IntPtr)(-1), 0);
            bool ok2 = EmptyWorkingSet(hProc);
            return ok1 || ok2;
        } finally {
            CloseHandle(hProc);
        }
    }

    // PROCESS_SUSPEND_RESUME (0x0800) | PROCESS_QUERY_INFORMATION (0x0400) | PROCESS_SET_QUOTA (0x0100)
    public static bool SuspendAndTrimPid(int pid) {
        IntPtr hProc = OpenProcess(0x0D00, false, pid);
        if (hProc == IntPtr.Zero) return false;
        try {
            NtSuspendProcess(hProc);
            bool ok1 = SetProcessWorkingSetSizeEx(hProc, (IntPtr)(-1), (IntPtr)(-1), 0);
            bool ok2 = EmptyWorkingSet(hProc);
            return ok1 || ok2;
        } finally {
            CloseHandle(hProc);
        }
    }
}
"@

# 1. Detecta sessões remotas (>= 2) e sessões do BotUser
$allProcs = Get-Process -ErrorAction SilentlyContinue
$remoteSessionIds = @($allProcs | Where-Object { $_.SessionId -ge 2 } | Select-Object -ExpandProperty SessionId -Unique)

try {
    $botByUser = Get-Process -IncludeUserName -ErrorAction SilentlyContinue |
        Where-Object { $_.UserName -like "*\BotUser" } |
        Select-Object -ExpandProperty SessionId -Unique
    if ($botByUser) {
        $remoteSessionIds = @($remoteSessionIds + $botByUser | Select-Object -Unique)
    }
} catch {}

if ($remoteSessionIds.Count -gt 0) {
    # Suspende (em vez de matar) processos que o Windows reinicia automaticamente com ~500 MB
    $suspendNames = @(
        "SearchHost", "msedgewebview2", "XboxPcAppFT",
        "WidgetBoard", "WidgetService", "CrossDeviceResume",
        "GameBar", "GameBarPresenceWriter",
        "XboxGameBarWidgets", "GameBarFTServer"
    )
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { ($remoteSessionIds -contains $_.SessionId) -and ($suspendNames -contains $_.ProcessName) } |
        ForEach-Object {
            try { [void][MemTrim]::SuspendAndTrimPid($_.Id) } catch {}
        }

    # Encerra apenas processos avulsos que não são reiniciados pelo Shell
    $killNames = @(
        "OneDrive", "OneDrive.Sync.Service", "EdgeGameAssist",
        "MicrosoftStartFeedProvider", "UserOOBEBroker", "msedge",
        "SecurityHealthSystray", "IntelGraphicsSoftware",
        "esbuild", "SystemSettingsAdminFlows"
    )
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { ($remoteSessionIds -contains $_.SessionId) -and ($killNames -contains $_.ProcessName) } |
        ForEach-Object {
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
}

# 2. Mantém prioridade BelowNormal no RobloxPlayerBeta para não travar a sessão principal
Get-Process -Name "RobloxPlayerBeta" -ErrorAction SilentlyContinue | ForEach-Object {
    try {
        if ($_.PriorityClass -ne [System.Diagnostics.ProcessPriorityClass]::BelowNormal) {
            $_.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal
        }
    } catch {}
}

# 3. Expurga memória inativa (Working Set)
$targetNames = @(
    "mstsc", "RobloxPlayerBeta", "node", "dwm", "explorer",
    "WindowsTerminal", "OpenConsole", "SearchHost", "StartMenuExperienceHost",
    "rdpclip", "sihost", "RuntimeBroker", "svchost"
)

$procs = Get-Process -ErrorAction SilentlyContinue
if (-not $All) {
    $procs = $procs | Where-Object {
        ($_.SessionId -ge 2) -or ($targetNames -contains $_.ProcessName)
    }
}

foreach ($p in $procs) {
    if ($p.Id -le 4) { continue }
    try {
        [void][MemTrim]::TrimPid($p.Id)
    } catch {}
}
