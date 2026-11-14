@echo off
start "" mstsc.exe /v:127.0.0.2 /w:960 /h:600
start "" /min powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$raw = [System.IO.File]::ReadAllText('%~f0', [System.Text.Encoding]::UTF8); $idx = $raw.IndexOf('#__PS_START__'); if ($idx -ge 0) { Invoke-Expression $raw.Substring($idx) }"
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
    [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
    [DllImport("user32.dll")] public static extern IntPtr GetSystemMenu(IntPtr hWnd, bool bRevert);
    [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr hMenu, uint uId, uint uFlags);
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
}
"@

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bounds = $screen.Bounds
$wa = $screen.WorkingArea
$w = [Math]::Max($bounds.Width, $wa.Width)

$zoomId = if ($w -ge 3840) { 0xB3 }
elseif ($w -ge 3360) { 0xB2 }
elseif ($w -ge 2880) { 0xA8 }
elseif ($w -ge 2400) { 0xA7 }
elseif ($w -ge 1920) { 0xA6 }
elseif ($w -ge 1680) { 0xA5 }
elseif ($w -ge 1360) { 0xA4 }
elseif ($w -ge 1150) { 0xA3 }
else { 0xA2 }

$targetHwnd = [IntPtr]::Zero
for ($i = 0; $i -lt 75; $i++) {
    Start-Sleep -Milliseconds 200
    $mstscPids = @(Get-Process -Name "mstsc" -ErrorAction SilentlyContinue |
        Sort-Object StartTime -Descending |
        Select-Object -ExpandProperty Id)
    if ($mstscPids.Count -eq 0) { continue }

    $script:found = [IntPtr]::Zero
    [RdpAutoScaler]::EnumWindows({
        param($hWnd, $lParam)
        $wPid = [uint32]0
        [RdpAutoScaler]::GetWindowThreadProcessId($hWnd, [ref]$wPid) | Out-Null
        if (($mstscPids -contains [int]$wPid) -and [RdpAutoScaler]::IsWindowVisible($hWnd)) {
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

    [void][RdpAutoScaler]::SendMessage($targetHwnd, 0x0112, [IntPtr]$zoomId, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 150
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
