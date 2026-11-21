@echo off
set "PESCA_BAT_PATH=%~f0"
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$p = $env:PESCA_BAT_PATH; $raw = [System.IO.File]::ReadAllText($p, [System.Text.Encoding]::UTF8); $m = '#__' + 'PS_START__'; $idx = $raw.IndexOf($m); if ($idx -ge 0) { Invoke-Expression $raw.Substring($idx) }"
exit /b

#__PS_START__
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class RdpAutoScaler {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern IntPtr GetSystemMenu(IntPtr hWnd, bool bRevert);
    [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr hMenu, uint uId, uint uFlags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@

$batDir = Split-Path -Parent $env:PESCA_BAT_PATH
$srcRdp = Join-Path $batDir "Sessao_BotUser.rdp"
if (Test-Path -LiteralPath $srcRdp) {
    $rdpText = [System.IO.File]::ReadAllText($srcRdp, [System.Text.Encoding]::UTF8)
    $docsTargets = @()
    $myDocs = [Environment]::GetFolderPath("MyDocuments")
    if ($myDocs) { $docsTargets += (Join-Path $myDocs "Default.rdp") }
    if ($env:USERPROFILE) { $docsTargets += (Join-Path $env:USERPROFILE "Documents\Default.rdp") }
    $seenDocs = @{}
    foreach ($dstRdp in $docsTargets) {
        $norm = $dstRdp.ToLowerInvariant()
        if ($seenDocs.ContainsKey($norm)) { continue }
        $seenDocs[$norm] = $true
        $dstDir = Split-Path -Parent $dstRdp
        if (-not (Test-Path -LiteralPath $dstDir)) {
            New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        }
        if (Test-Path -LiteralPath $dstRdp) {
            $item = Get-Item -LiteralPath $dstRdp -Force
            $strip = [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::ReadOnly
            if ($item.Attributes -band $strip) {
                $item.Attributes = $item.Attributes -band (-bnot $strip)
            }
        }
        [System.IO.File]::WriteAllText($dstRdp, $rdpText, [System.Text.Encoding]::Unicode)
    }
}

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$wa = $screen.WorkingArea
$scale = [Math]::Min($bounds.Width / 960.0, $bounds.Height / 600.0)

$zoomId = if ($scale -ge 5.0) { 0xB5 }
elseif ($scale -ge 4.5) { 0xB4 }
elseif ($scale -ge 4.0) { 0xB3 }
elseif ($scale -ge 3.5) { 0xB2 }
elseif ($scale -ge 3.0) { 0xA8 }
elseif ($scale -ge 2.5) { 0xA7 }
elseif ($scale -ge 2.0) { 0xA6 }
elseif ($scale -ge 1.75) { 0xA5 }
elseif ($scale -ge 1.50) { 0xA4 }
elseif ($scale -ge 1.25) { 0xA3 }
else { 0xA2 }

$proc = Start-Process -FilePath "mstsc.exe" -ArgumentList "/v:127.0.0.2 /w:960 /h:600" -PassThru
$targetPid = [uint32]$proc.Id
$targetHwnd = [IntPtr]::Zero

for ($i = 0; $i -lt 75; $i++) {
    if ($proc.HasExited) { break }
    Start-Sleep -Milliseconds 200
    $script:found = [IntPtr]::Zero
    [RdpAutoScaler]::EnumWindows({
        param($hWnd, $lParam)
        $wPid = [uint32]0
        [RdpAutoScaler]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
        if (($wPid -eq $targetPid) -and [RdpAutoScaler]::IsWindowVisible($hWnd)) {
            $sb = New-Object System.Text.StringBuilder 256
            [RdpAutoScaler]::GetClassName($hWnd, $sb, 256) | Out-Null
            if ($sb.ToString() -eq "TscShellContainerClass") {
                $script:found = $hWnd
                return $false
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null

    if ($script:found -ne [IntPtr]::Zero) {
        $hMenuCheck = [RdpAutoScaler]::GetSystemMenu($script:found, $false)
        $smartState = [RdpAutoScaler]::GetMenuState($hMenuCheck, 0x91, 0)
        if ($smartState -ne [uint32]::MaxValue) {
            $targetHwnd = $script:found
            break
        }
    }
}

if ($targetHwnd -ne [IntPtr]::Zero) {
    Start-Sleep -Milliseconds 600
    $hMenu = [RdpAutoScaler]::GetSystemMenu($targetHwnd, $false)
    $state = [RdpAutoScaler]::GetMenuState($hMenu, 0x91, 0)
    if (($state -ne [uint32]::MaxValue) -and (($state -band 0x8) -ne 0)) {
        [void][RdpAutoScaler]::SendMessage($targetHwnd, 0x0112, [IntPtr]0x91, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 150
    }

    [void][RdpAutoScaler]::SetForegroundWindow($targetHwnd)
    [void][RdpAutoScaler]::SendMessage($targetHwnd, 0x0112, [IntPtr]0x9D, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 400
    [void][RdpAutoScaler]::SendMessage($targetHwnd, 0x0112, [IntPtr]$zoomId, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 250

    $wr = New-Object RdpAutoScaler+RECT
    [void][RdpAutoScaler]::GetWindowRect($targetHwnd, [ref]$wr)
    if (($wr.Right - $wr.Left) -lt $bounds.Width) {
        [void][RdpAutoScaler]::MoveWindow($targetHwnd, $wa.X, $wa.Y, $wa.Width, $wa.Height, $true)
        Start-Sleep -Milliseconds 150
        $rcClient = New-Object RdpAutoScaler+RECT
        [void][RdpAutoScaler]::GetClientRect($targetHwnd, [ref]$rcClient)
        $cw = $rcClient.Right - $rcClient.Left
        $ch = $rcClient.Bottom - $rcClient.Top
        if ($cw -gt 0 -and $ch -gt 0) {
            $childClasses = @(
                "TscShellAxHostClass",
                "UIMainClass",
                "UIContainerClass",
                "IHWindowClass",
                "OPContainerClass",
                "OPWindowClass"
            )
            [RdpAutoScaler]::EnumChildWindows($targetHwnd, {
                param($child, $lp)
                $sb = New-Object System.Text.StringBuilder 256
                [RdpAutoScaler]::GetClassName($child, $sb, 256) | Out-Null
                if ($childClasses -contains $sb.ToString()) {
                    [void][RdpAutoScaler]::MoveWindow($child, 0, 0, $cw, $ch, $true)
                }
                return $true
            }, [IntPtr]::Zero) | Out-Null
        }
    }
}
