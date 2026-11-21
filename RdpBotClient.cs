using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Windows.Forms;

namespace RdpBotClientApp
{
    [ComImport]
    [Guid("c1e6743a-41c1-4a74-832a-0dd06c1c7a0e")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMsTscNonScriptable
    {
        void put_ClearTextPassword([MarshalAs(UnmanagedType.BStr)] string newVal);
    }

    [ComImport]
    [Guid("302d8188-0052-4807-806a-362b628f9ac5")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IMsRdpExtendedSettings
    {
        void set_Property([MarshalAs(UnmanagedType.BStr)] string bstrPropertyName, [In] ref object pValue);
        void get_Property([MarshalAs(UnmanagedType.BStr)] string bstrPropertyName, out object pValue);
    }

    [ComImport]
    [Guid("336d5562-efa8-482e-8cb3-c5c0fc7a7db6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IMsTscAxEvents
    {
        [DispId(2)]
        void OnConnected();
        [DispId(4)]
        void OnDisconnected(int discReason);
        [DispId(8)]
        void OnRequestGoFullScreen();
        [DispId(9)]
        void OnRequestLeaveFullScreen();
        [DispId(14)]
        void OnRequestContainerMinimize();
        [DispId(26)]
        void OnMouseInputModeChanged([MarshalAs(UnmanagedType.VariantBool)] bool fMouseModeRelative);
    }

    [ClassInterface(ClassInterfaceType.None)]
    internal sealed class RdpEventSink : IMsTscAxEvents
    {
        private readonly RdpBotForm owner;

        public RdpEventSink(RdpBotForm ownerForm)
        {
            owner = ownerForm;
        }

        public void OnConnected()
        {
            owner.HandleRdpConnected();
        }

        public void OnDisconnected(int discReason)
        {
            owner.HandleRdpDisconnected(discReason);
        }

        public void OnRequestGoFullScreen()
        {
            owner.HandleRdpRequestToggleFullScreen();
        }

        public void OnRequestLeaveFullScreen()
        {
            owner.HandleRdpRequestToggleFullScreen();
        }

        public void OnRequestContainerMinimize()
        {
            owner.HandleRdpRequestMinimize();
        }

        public void OnMouseInputModeChanged(bool fMouseModeRelative)
        {
            owner.HandleRdpMouseInputModeChanged(fMouseModeRelative);
        }
    }

    internal sealed class RdpAxControl : AxHost
    {
        public RdpAxControl(string clsid) : base(clsid) { }

        public object Ocx
        {
            get { return GetOcx(); }
        }
    }

    internal sealed class FullscreenBarForm : Form
    {
        private readonly Button btnWindow;
        private readonly Button btnRelativeMouse;
        private readonly Button btnScaleMode;
        private readonly Button btnMinimize;
        private readonly Button btnClose;
        private readonly FlowLayoutPanel flow;

        public event EventHandler RequestWindowed;
        public event EventHandler RequestToggleRelativeMouse;
        public event EventHandler RequestToggleScaleMode;
        public event EventHandler RequestMinimize;
        public event EventHandler RequestCloseApp;

        protected override bool ShowWithoutActivation
        {
            get { return true; }
        }

        public FullscreenBarForm()
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            BackColor = Color.FromArgb(24, 26, 32);
            Padding = new Padding(6, 3, 6, 3);

            flow = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                AutoSize = true,
                WrapContents = false,
                BackColor = Color.Transparent,
                Margin = new Padding(0),
                Padding = new Padding(0)
            };

            btnWindow = CreateBarButton("Janela (Ctrl+Alt+Enter)", Color.FromArgb(46, 52, 64));
            btnWindow.Click += delegate { if (RequestWindowed != null) RequestWindowed(this, EventArgs.Empty); };

            btnRelativeMouse = CreateBarButton("Mouse Relativo: OFF (Ctrl+Alt+\\ ou M)", Color.FromArgb(46, 52, 64));
            btnRelativeMouse.Click += delegate { if (RequestToggleRelativeMouse != null) RequestToggleRelativeMouse(this, EventArgs.Empty); };

            btnScaleMode = CreateBarButton("Escala: Preencher", Color.FromArgb(46, 52, 64));
            btnScaleMode.Click += delegate { if (RequestToggleScaleMode != null) RequestToggleScaleMode(this, EventArgs.Empty); };

            btnMinimize = CreateBarButton(" _ ", Color.FromArgb(46, 52, 64));
            btnMinimize.Click += delegate { if (RequestMinimize != null) RequestMinimize(this, EventArgs.Empty); };

            btnClose = CreateBarButton(" X ", Color.FromArgb(130, 42, 46));
            btnClose.Click += delegate { if (RequestCloseApp != null) RequestCloseApp(this, EventArgs.Empty); };

            flow.Controls.Add(btnWindow);
            flow.Controls.Add(btnRelativeMouse);
            flow.Controls.Add(btnScaleMode);
            flow.Controls.Add(btnMinimize);
            flow.Controls.Add(btnClose);

            Controls.Add(flow);
            Paint += OnBarPaint;
            RecalcLayout();
        }

        private static Button CreateBarButton(string text, Color backColor)
        {
            return new Button
            {
                Text = text,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                MinimumSize = new Size(28, 24),
                Padding = new Padding(6, 0, 6, 0),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.White,
                BackColor = backColor,
                Font = new Font("Segoe UI", 8.2f),
                Margin = new Padding(0, 0, 5, 0),
                TabStop = false
            };
        }

        private void OnBarPaint(object sender, PaintEventArgs e)
        {
            using (var pen = new Pen(Color.FromArgb(72, 82, 102)))
            {
                e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
            }
        }

        public void SyncState(bool relativeMouseActive, bool fillWindowMode)
        {
            btnRelativeMouse.Text = relativeMouseActive
                ? "Mouse Relativo: ATIVO (Ctrl+Alt+\\ ou M)"
                : "Mouse Relativo: OFF (Ctrl+Alt+\\ ou M)";
            btnRelativeMouse.BackColor = relativeMouseActive
                ? Color.FromArgb(38, 108, 68)
                : Color.FromArgb(46, 52, 64);

            btnScaleMode.Text = fillWindowMode ? "Escala: Preencher" : "Escala: 16:10";
            RecalcLayout();
        }

        public void RecalcLayout()
        {
            Size pref = flow.GetPreferredSize(new Size(2000, 40));
            int w = Math.Max(320, pref.Width + Padding.Horizontal);
            int h = Math.Max(30, pref.Height + Padding.Vertical);
            Size = new Size(w, h);
        }

        public void PositionAtTopCenter(Rectangle screenBounds)
        {
            RecalcLayout();
            int x = screenBounds.Left + Math.Max(0, (screenBounds.Width - Width) / 2);
            int y = screenBounds.Top;
            Location = new Point(x, y);
        }
    }

    internal sealed class ClientLaunchOptions
    {
        public bool StartWindowed;
        public bool TestToggleRelative;
        public string DiagnosticsPath;
        public string SoftwareCaptureFullscreenPath;
        public string SoftwareCaptureWindowedPath;
    }

    public sealed class RdpBotForm : Form
    {
        private const int RemoteWidth = 960;
        private const int RemoteHeight = 600;
        private const int PerfDisableBase = 0x0F;
        private const uint ModControlAltNoRepeat = 0x0001 | 0x0002 | 0x4000;
        private const int HotkeyFullscreenId = 101;
        private const int HotkeyRelativeMouseMId = 102;
        private const int HotkeyRelativeMouseBackslashId = 103;
        private const int WmHotkey = 0x0312;
        private const int WmKeyDown = 0x0100;
        private const int WmSysKeyDown = 0x0104;
        private const uint VkControl = 0x11;
        private const uint VkLControl = 0xA2;
        private const uint VkMenu = 0x12;
        private const uint VkLMenu = 0xA4;
        private const uint VkOem5 = 0xDC;
        private const uint VkOem102 = 0xE2;
        private const uint RidevCaptureMouse = 0x00000200;
        private const uint RidevNoHotKeysOrNoLegacy = 0x00000030;

        private static readonly string[] CandidateClsids = new[]
        {
            "1df7c823-b2d4-4b54-975a-f2ac5d7cf8b8", // MsRdpClient11NotSafeForScripting
            "a0c63c30-f08d-4ab4-907c-34905d770c7d", // MsRdpClient10NotSafeForScripting
            "8b918b82-7985-4c24-89df-c33ad2bbfbcd"  // MsRdpClient9NotSafeForScripting
        };

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RAWINPUTDEVICE
        {
            public ushort usUsagePage;
            public ushort usUsage;
            public uint dwFlags;
            public IntPtr hwndTarget;
        }

        private delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll")]
        private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool EnumChildWindows(IntPtr hWndParent, EnumChildProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetRegisteredRawInputDevices([Out] RAWINPUTDEVICE[] pRawInputDevices, ref uint puiNumDevices, uint cbSize);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll")]
        private static extern uint GetCurrentThreadId();

        [DllImport("user32.dll")]
        private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("user32.dll")]
        private static extern bool GetKeyboardState(byte[] lpKeyState);

        [DllImport("user32.dll")]
        private static extern bool SetKeyboardState(byte[] lpKeyState);

        [DllImport("user32.dll")]
        private static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern IntPtr SetFocus(IntPtr hWnd);

        private readonly ClientLaunchOptions launchOptions;
        private readonly Panel toolbarPanel;
        private readonly Button btnFullscreen;
        private readonly Button btnRelativeMouse;
        private readonly Button btnScaleMode;
        private readonly Label lblStatus;
        private readonly Panel rdpHostPanel;

        private FullscreenBarForm fullscreenBar;
        private RdpAxControl rdpAx;
        private dynamic ocx;
        private dynamic adv;
        private IMsRdpExtendedSettings extSettings;
        private IConnectionPoint eventConnectionPoint;
        private int eventCookie = 0;
        private RdpEventSink eventSink;

        private string activeClsid = "";
        private int activeKeyboardHookMode = 0;
        private bool relativeMouseActive = false;
        private bool? lastMouseModeRelative = null;
        private string disconnectNote = "";
        private bool fillWindowMode = true;
        private bool isFullScreen = false;
        private bool hotkeysRegistered = false;
        private DateTime lastHotkeyToggleUtc = DateTime.MinValue;
        private DateTime hintBarUntilUtc = DateTime.MinValue;
        private DateTime barHideDeadlineUtc = DateTime.MinValue;

        private string testRelBefore = "unset";
        private string testRelAfterOn = "unset";
        private string testRelAfterOff = "unset";

        private FormBorderStyle savedBorderStyle = FormBorderStyle.Sizable;
        private FormWindowState savedWindowState = FormWindowState.Maximized;
        private Rectangle savedBounds;
        private Timer watcherTimer;

        internal RdpBotForm(ClientLaunchOptions options)
        {
            launchOptions = options ?? new ClientLaunchOptions();

            Text = "BotUser (960x600) - Sessao RDP";
            BackColor = Color.Black;
            AutoScaleMode = AutoScaleMode.None;
            StartPosition = FormStartPosition.Manual;
            MinimumSize = new Size(480, 340);
            KeyPreview = true;

            toolbarPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = 32,
                BackColor = Color.FromArgb(24, 24, 28),
                Padding = new Padding(6, 4, 6, 4)
            };

            btnFullscreen = CreateToolbarButton("Tela Cheia (Ctrl+Alt+Enter)", Color.FromArgb(46, 50, 60));
            btnFullscreen.Click += delegate { ToggleFullScreen(); };

            btnRelativeMouse = CreateToolbarButton("Mouse Relativo: OFF (Ctrl+Alt+\\ ou M)", Color.FromArgb(46, 50, 60));
            btnRelativeMouse.Click += delegate { ToggleNativeRelativeMouse(true); };

            btnScaleMode = CreateToolbarButton("Escala: Preencher", Color.FromArgb(46, 50, 60));
            btnScaleMode.Click += delegate { ToggleScaleMode(); };

            lblStatus = new Label
            {
                Dock = DockStyle.Fill,
                ForeColor = Color.FromArgb(200, 205, 215),
                Font = new Font("Segoe UI", 8.5f),
                TextAlign = ContentAlignment.MiddleRight,
                Text = "Conectando..."
            };

            var flow = new FlowLayoutPanel
            {
                Dock = DockStyle.Left,
                AutoSize = true,
                WrapContents = false,
                BackColor = Color.Transparent,
                Margin = new Padding(0),
                Padding = new Padding(0)
            };
            flow.Controls.Add(btnFullscreen);
            flow.Controls.Add(btnRelativeMouse);
            flow.Controls.Add(btnScaleMode);

            toolbarPanel.Controls.Add(lblStatus);
            toolbarPanel.Controls.Add(flow);

            rdpHostPanel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.Black
            };
            rdpHostPanel.Resize += delegate { LayoutRdpControl(); };

            Controls.Add(rdpHostPanel);
            Controls.Add(toolbarPanel);

            savedBorderStyle = FormBorderStyle.Sizable;
            savedWindowState = FormWindowState.Maximized;
            savedBounds = Screen.PrimaryScreen.WorkingArea;

            if (launchOptions.StartWindowed)
            {
                isFullScreen = false;
                FormBorderStyle = FormBorderStyle.Sizable;
                WindowState = FormWindowState.Maximized;
                toolbarPanel.Visible = true;
            }
            else
            {
                isFullScreen = true;
                toolbarPanel.Visible = false;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;
                Bounds = Screen.PrimaryScreen.Bounds;
            }

            Load += OnFormLoad;
            Resize += OnFormResize;
            FormClosing += OnFormClosing;
        }

        private static Button CreateToolbarButton(string text, Color backColor)
        {
            return new Button
            {
                Text = text,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                MinimumSize = new Size(90, 24),
                Padding = new Padding(8, 0, 8, 0),
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.White,
                BackColor = backColor,
                Font = new Font("Segoe UI", 8.2f),
                Margin = new Padding(0, 0, 6, 0),
                TabStop = false
            };
        }

        private void OnFormLoad(object sender, EventArgs e)
        {
            EnsureFullscreenBar();
            if (isFullScreen)
            {
                SetFullScreen(true, false);
            }

            InitializeRdpControl();
            UpdateButtonsAndStatus();

            watcherTimer = new Timer { Interval = 120 };
            watcherTimer.Tick += delegate { OnWatcherTick(); };
            watcherTimer.Start();

            if (!string.IsNullOrEmpty(launchOptions.DiagnosticsPath) ||
                !string.IsNullOrEmpty(launchOptions.SoftwareCaptureFullscreenPath) ||
                launchOptions.TestToggleRelative)
            {
                StartAutomatedTestSequence();
            }
        }

        private void OnFormResize(object sender, EventArgs e)
        {
            if (WindowState == FormWindowState.Minimized && fullscreenBar != null && fullscreenBar.Visible)
            {
                fullscreenBar.Hide();
            }
            LayoutRdpControl();
        }

        private void EnsureFullscreenBar()
        {
            if (fullscreenBar != null && !fullscreenBar.IsDisposed) return;
            fullscreenBar = new FullscreenBarForm { Owner = this };
            fullscreenBar.RequestWindowed += delegate { SetFullScreen(false, true); };
            fullscreenBar.RequestToggleRelativeMouse += delegate { ToggleNativeRelativeMouse(true); };
            fullscreenBar.RequestToggleScaleMode += delegate { ToggleScaleMode(); };
            fullscreenBar.RequestMinimize += delegate { MinimizeClient(); };
            fullscreenBar.RequestCloseApp += delegate { Close(); };
            fullscreenBar.SyncState(relativeMouseActive, fillWindowMode);
        }

        private void InitializeRdpControl()
        {
            Exception lastErr = null;
            foreach (string clsid in CandidateClsids)
            {
                RdpAxControl candidate = null;
                try
                {
                    candidate = new RdpAxControl(clsid);
                    ((ISupportInitialize)candidate).BeginInit();
                    rdpHostPanel.Controls.Add(candidate);
                    ((ISupportInitialize)candidate).EndInit();
                    candidate.CreateControl();
                    object testOcx = candidate.Ocx;
                    if (testOcx == null) throw new InvalidOperationException("GetOcx retornou null.");

                    rdpAx = candidate;
                    ocx = testOcx;
                    activeClsid = clsid;
                    break;
                }
                catch (Exception ex)
                {
                    lastErr = ex;
                    if (candidate != null)
                    {
                        rdpHostPanel.Controls.Remove(candidate);
                        candidate.Dispose();
                    }
                }
            }

            if (rdpAx == null || ocx == null)
            {
                MessageBox.Show("Falha ao inicializar mstscax.dll: " + (lastErr != null ? lastErr.Message : "desconhecido"),
                    "RdpBotClient", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }

            AttachRdpEventSink();
            LayoutRdpControl();
            ConfigureAndConnect();
        }

        private void AttachRdpEventSink()
        {
            try
            {
                var cpc = ocx as IConnectionPointContainer;
                if (cpc == null) return;
                Guid evGuid = typeof(IMsTscAxEvents).GUID;
                IConnectionPoint cp;
                cpc.FindConnectionPoint(ref evGuid, out cp);
                if (cp == null) return;
                eventSink = new RdpEventSink(this);
                int cookie;
                cp.Advise(eventSink, out cookie);
                eventConnectionPoint = cp;
                eventCookie = cookie;
            }
            catch { }
        }

        private void ConfigureAndConnect()
        {
            ocx.Server = "127.0.0.2";
            ocx.UserName = "BotUser";
            ocx.Domain = Environment.MachineName;
            ocx.DesktopWidth = RemoteWidth;
            ocx.DesktopHeight = RemoteHeight;
            ocx.ColorDepth = 32;

            IMsTscNonScriptable nonScript = ocx as IMsTscNonScriptable;
            if (nonScript != null)
            {
                nonScript.put_ClearTextPassword("123");
            }

            adv = null;
            try { adv = ocx.AdvancedSettings8; } catch { }
            if (adv == null) { try { adv = ocx.AdvancedSettings7; } catch { } }
            if (adv == null) { adv = ocx.AdvancedSettings6; }

            if (adv != null)
            {
                TrySet(() => adv.EnableCredSspSupport = false);
                TrySet(() => adv.AuthenticationLevel = 0);
                TrySet(() => adv.NegotiateSecurityLayer = 0);
                TrySet(() => adv.EnableAutoReconnect = true);
                TrySet(() => adv.MaxReconnectAttempts = 5);
                TrySet(() => adv.BitmapPeristence = 0);
                TrySet(() => adv.Compress = 1);
                TrySet(() => adv.AudioRedirectionMode = 2);
                TrySet(() => adv.RedirectPrinters = false);
                TrySet(() => adv.RedirectDrives = false);
                TrySet(() => adv.RedirectPorts = false);
                TrySet(() => adv.RedirectSmartCards = false);
                TrySet(() => adv.RedirectClipboard = false);
                TrySet(() => adv.PerformanceFlags = PerfDisableBase);
                TrySet(() => adv.DisplayConnectionBar = false);
                TrySet(() => adv.ContainerHandledFullScreen = 1);
                TrySet(() => adv.GrabFocusOnConnect = true);
                TrySet(() => adv.SmartSizing = true);
                TrySet(() => adv.RelativeMouseMode = false);
                TrySet(() => adv.NetworkConnectionType = 6u);
            }

            TrySet(() => { ocx.SecuredSettings2.AudioRedirectionMode = 2; });
            TrySet(() =>
            {
                ocx.SecuredSettings2.KeyboardHookMode = 0;
                activeKeyboardHookMode = (int)ocx.SecuredSettings2.KeyboardHookMode;
            });

            extSettings = ocx as IMsRdpExtendedSettings;
            if (extSettings != null)
            {
                SetExtProperty("AllowRelativeMouseMode", true);
                SetExtProperty("HighResolutionMouse", true);
                SetExtProperty("High Resolution Mouse", true);
                SetExtProperty("IgnoreServerGeneratedMouseMoves", false);
                SetExtProperty("EnableZoom", true);
                if (!string.IsNullOrEmpty(launchOptions.SoftwareCaptureFullscreenPath))
                {
                    SetExtProperty("EnableHardwareMode", false);
                }
            }

            ocx.Connect();
        }

        internal void HandleRdpConnected()
        {
            if (IsDisposed) return;
            BeginInvoke((MethodInvoker)delegate
            {
                disconnectNote = "";
                if (adv != null)
                {
                    TrySet(() => adv.RelativeMouseMode = false);
                    TrySet(() => adv.SmartSizing = true);
                }
                SetExtProperty("AllowRelativeMouseMode", true);
                relativeMouseActive = IsNativeRelativeMouseCaptured();
                if (isFullScreen && string.IsNullOrEmpty(launchOptions.SoftwareCaptureFullscreenPath) && !launchOptions.TestToggleRelative)
                {
                    hintBarUntilUtc = DateTime.UtcNow.AddSeconds(3);
                    ShowFullscreenBar();
                }
                UpdateButtonsAndStatus();
            });
        }

        internal void HandleRdpDisconnected(int discReason)
        {
            if (IsDisposed) return;
            BeginInvoke((MethodInvoker)delegate
            {
                disconnectNote = "Desconectado (codigo " + discReason + ")";
                relativeMouseActive = false;
                UpdateButtonsAndStatus();
            });
        }

        internal void HandleRdpRequestToggleFullScreen()
        {
            if (IsDisposed) return;
            BeginInvoke((MethodInvoker)delegate
            {
                DateTime now = DateTime.UtcNow;
                if ((now - lastHotkeyToggleUtc).TotalMilliseconds < 300) return;
                lastHotkeyToggleUtc = now;
                ToggleFullScreen();
            });
        }

        internal void HandleRdpRequestMinimize()
        {
            if (IsDisposed) return;
            BeginInvoke((MethodInvoker)delegate { MinimizeClient(); });
        }

        internal void HandleRdpMouseInputModeChanged(bool fMouseModeRelative)
        {
            if (IsDisposed) return;
            BeginInvoke((MethodInvoker)delegate
            {
                lastMouseModeRelative = fMouseModeRelative;
                relativeMouseActive = IsNativeRelativeMouseCaptured();
                UpdateButtonsAndStatus();
            });
        }

        private void SetExtProperty(string name, object val)
        {
            if (extSettings == null) return;
            try
            {
                object v = val;
                extSettings.set_Property(name, ref v);
            }
            catch { }
        }

        private object GetExtProperty(string name)
        {
            if (extSettings == null) return null;
            try
            {
                object v;
                extSettings.get_Property(name, out v);
                return v;
            }
            catch { return null; }
        }

        private static void TrySet(Action action)
        {
            try { action(); } catch { }
        }

        private IntPtr FindInputHandlerWindow()
        {
            if (!IsHandleCreated || IsDisposed) return IntPtr.Zero;
            IntPtr found = IntPtr.Zero;
            EnumChildWindows(Handle, (ch, lp) =>
            {
                var sb = new StringBuilder(64);
                GetClassName(ch, sb, 64);
                if (sb.ToString() == "IHWindowClass")
                {
                    found = ch;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        private bool IsNativeRelativeMouseCaptured()
        {
            try
            {
                uint count = 0;
                uint cbSize = (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE));
                GetRegisteredRawInputDevices(null, ref count, cbSize);
                if (count == 0) return false;

                var devices = new RAWINPUTDEVICE[count];
                uint fetched = GetRegisteredRawInputDevices(devices, ref count, cbSize);
                if (fetched == uint.MaxValue) return false;

                IntPtr ihHwnd = FindInputHandlerWindow();
                for (int i = 0; i < (int)Math.Min(fetched, (uint)devices.Length); i++)
                {
                    if (devices[i].usUsagePage == 1 && devices[i].usUsage == 2)
                    {
                        if ((devices[i].dwFlags & RidevCaptureMouse) != 0)
                        {
                            return true;
                        }
                        if (ihHwnd != IntPtr.Zero && devices[i].hwndTarget == ihHwnd &&
                            (devices[i].dwFlags & RidevNoHotKeysOrNoLegacy) != 0)
                        {
                            return true;
                        }
                    }
                }
            }
            catch { }
            return false;
        }

        private void ToggleNativeRelativeMouse(bool fromButton)
        {
            if (fromButton)
            {
                FocusRdpHost();
                var delayTimer = new Timer { Interval = 60 };
                delayTimer.Tick += delegate
                {
                    delayTimer.Stop();
                    delayTimer.Dispose();
                    if (!IsDisposed)
                    {
                        ExecuteNativeRelativeMouseKeySequence();
                    }
                };
                delayTimer.Start();
                return;
            }

            ExecuteNativeRelativeMouseKeySequence();
        }

        private bool ExecuteNativeRelativeMouseKeySequence()
        {
            IntPtr ihHwnd = FindInputHandlerWindow();
            if (ihHwnd == IntPtr.Zero) return false;

            bool before = IsNativeRelativeMouseCaptured();
            uint pid;
            uint ihTid = GetWindowThreadProcessId(ihHwnd, out pid);
            uint curTid = GetCurrentThreadId();
            bool attached = false;

            try
            {
                if (ihTid != 0 && ihTid != curTid)
                {
                    attached = AttachThreadInput(curTid, ihTid, true);
                }

                SetFocus(ihHwnd);

                var savedState = new byte[256];
                var tempState = new byte[256];
                if (GetKeyboardState(savedState))
                {
                    Buffer.BlockCopy(savedState, 0, tempState, 0, 256);
                }

                tempState[VkControl] = (byte)(tempState[VkControl] | 0x80);
                tempState[VkLControl] = (byte)(tempState[VkLControl] | 0x80);
                tempState[VkMenu] = (byte)(tempState[VkMenu] | 0x80);
                tempState[VkLMenu] = (byte)(tempState[VkLMenu] | 0x80);
                tempState[VkOem5] = (byte)(tempState[VkOem5] | 0x80);

                uint sc = MapVirtualKey(VkOem5, 0);
                if (sc == 0) sc = 0x2B;

                SetKeyboardState(tempState);
                try
                {
                    IntPtr lParamKeyDown = (IntPtr)(int)((sc << 16) | 1u);
                    SendMessage(ihHwnd, WmKeyDown, (IntPtr)VkOem5, lParamKeyDown);

                    if (IsNativeRelativeMouseCaptured() == before)
                    {
                        IntPtr lParamSysKeyDown = (IntPtr)unchecked((int)(0x20000001u | (sc << 16)));
                        SendMessage(ihHwnd, WmSysKeyDown, (IntPtr)VkOem5, lParamSysKeyDown);
                    }
                }
                finally
                {
                    SetKeyboardState(savedState);
                }
            }
            finally
            {
                if (attached)
                {
                    AttachThreadInput(curTid, ihTid, false);
                }
            }

            relativeMouseActive = IsNativeRelativeMouseCaptured();
            UpdateButtonsAndStatus();
            return relativeMouseActive != before;
        }

        private void LayoutRdpControl()
        {
            if (rdpAx == null || rdpHostPanel == null) return;
            int pw = Math.Max(1, rdpHostPanel.ClientSize.Width);
            int ph = Math.Max(1, rdpHostPanel.ClientSize.Height);

            if (fillWindowMode)
            {
                rdpAx.Bounds = new Rectangle(0, 0, pw, ph);
            }
            else
            {
                int targetW, targetH;
                if (pw * 10 > ph * 16)
                {
                    targetH = ph;
                    targetW = (int)Math.Round(ph * 16.0 / 10.0);
                }
                else
                {
                    targetW = pw;
                    targetH = (int)Math.Round(pw * 10.0 / 16.0);
                }
                rdpAx.Bounds = new Rectangle((pw - targetW) / 2, (ph - targetH) / 2, targetW, targetH);
            }
            UpdateButtonsAndStatus();
        }

        private void ToggleFullScreen()
        {
            SetFullScreen(!isFullScreen, true);
        }

        private void SetFullScreen(bool enable, bool focusRdp)
        {
            if (enable)
            {
                if (!isFullScreen)
                {
                    savedBorderStyle = FormBorderStyle;
                    savedWindowState = WindowState;
                    if (WindowState == FormWindowState.Normal)
                    {
                        savedBounds = Bounds;
                    }
                }
                Rectangle scr = Screen.FromControl(this).Bounds;
                toolbarPanel.Visible = false;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;
                Bounds = scr;
                isFullScreen = true;
                if (fullscreenBar != null && !fullscreenBar.IsDisposed)
                {
                    fullscreenBar.PositionAtTopCenter(scr);
                }
            }
            else
            {
                isFullScreen = false;
                if (fullscreenBar != null && !fullscreenBar.IsDisposed && fullscreenBar.Visible)
                {
                    fullscreenBar.Hide();
                }
                FormBorderStyle = savedBorderStyle;
                toolbarPanel.Visible = true;
                WindowState = savedWindowState;
                if (savedWindowState == FormWindowState.Normal && savedBounds.Width > 0 && savedBounds.Height > 0)
                {
                    Bounds = savedBounds;
                }
            }

            rdpHostPanel.PerformLayout();
            LayoutRdpControl();
            if (focusRdp)
            {
                FocusRdpHost();
            }
        }

        private void MinimizeClient()
        {
            if (fullscreenBar != null && !fullscreenBar.IsDisposed && fullscreenBar.Visible)
            {
                fullscreenBar.Hide();
            }
            WindowState = FormWindowState.Minimized;
        }

        private void ToggleScaleMode()
        {
            fillWindowMode = !fillWindowMode;
            LayoutRdpControl();
            FocusRdpHost();
        }

        private void FocusRdpHost()
        {
            try
            {
                Activate();
                if (rdpAx != null) rdpAx.Focus();
            }
            catch { }
        }

        private void UpdateButtonsAndStatus()
        {
            if (btnRelativeMouse != null)
            {
                btnRelativeMouse.Text = relativeMouseActive
                    ? "Mouse Relativo: ATIVO (Ctrl+Alt+\\ ou M)"
                    : "Mouse Relativo: OFF (Ctrl+Alt+\\ ou M)";
                btnRelativeMouse.BackColor = relativeMouseActive
                    ? Color.FromArgb(38, 108, 68)
                    : Color.FromArgb(46, 50, 60);
            }
            if (btnScaleMode != null)
            {
                btnScaleMode.Text = fillWindowMode ? "Escala: Preencher" : "Escala: 16:10";
            }
            if (btnFullscreen != null)
            {
                btnFullscreen.Text = isFullScreen
                    ? "Janela (Ctrl+Alt+Enter)"
                    : "Tela Cheia (Ctrl+Alt+Enter)";
            }
            if (fullscreenBar != null && !fullscreenBar.IsDisposed)
            {
                fullscreenBar.SyncState(relativeMouseActive, fillWindowMode);
                if (fullscreenBar.Visible)
                {
                    fullscreenBar.PositionAtTopCenter(Screen.FromControl(this).Bounds);
                }
            }
            if (lblStatus != null && rdpAx != null)
            {
                if (!string.IsNullOrEmpty(disconnectNote))
                {
                    lblStatus.Text = disconnectNote;
                }
                else
                {
                    string modeLabel = relativeMouseActive ? "ATIVO" : "OFF";
                    lblStatus.Text = string.Format("Interno: {0}x{1} -> Janela: {2}x{3} | Mouse Relativo ({4}): Ctrl+Alt+\\, Ctrl+Alt+M ou Ctrl+Alt+]",
                        RemoteWidth, RemoteHeight, rdpAx.Width, rdpAx.Height, modeLabel);
                }
            }
        }

        private bool IsAppForeground()
        {
            if (!IsHandleCreated || IsDisposed) return false;
            IntPtr fg = GetForegroundWindow();
            if (fg == IntPtr.Zero) return false;
            if (fg == Handle || IsChild(Handle, fg)) return true;
            if (fullscreenBar != null && !fullscreenBar.IsDisposed && fullscreenBar.IsHandleCreated)
            {
                if (fg == fullscreenBar.Handle || IsChild(fullscreenBar.Handle, fg)) return true;
            }
            return false;
        }

        private void ShowFullscreenBar()
        {
            if (!isFullScreen || WindowState == FormWindowState.Minimized) return;
            EnsureFullscreenBar();
            fullscreenBar.PositionAtTopCenter(Screen.FromControl(this).Bounds);
            if (!fullscreenBar.Visible)
            {
                fullscreenBar.Show(this);
            }
        }

        private void OnWatcherTick()
        {
            SyncHotkeysWithForeground();
            bool liveCap = IsNativeRelativeMouseCaptured();
            if (liveCap != relativeMouseActive)
            {
                relativeMouseActive = liveCap;
                UpdateButtonsAndStatus();
            }
            UpdateFullscreenBarAutoHide();
        }

        private void SyncHotkeysWithForeground()
        {
            if (!IsHandleCreated || IsDisposed) return;
            bool activeHere = IsAppForeground() && WindowState != FormWindowState.Minimized;
            if (activeHere && !hotkeysRegistered)
            {
                bool ok1 = RegisterHotKey(Handle, HotkeyFullscreenId, ModControlAltNoRepeat, (uint)Keys.Return);
                bool ok2 = RegisterHotKey(Handle, HotkeyRelativeMouseMId, ModControlAltNoRepeat, (uint)Keys.M);
                bool ok3 = RegisterHotKey(Handle, HotkeyRelativeMouseBackslashId, ModControlAltNoRepeat, VkOem102);
                hotkeysRegistered = ok1 || ok2 || ok3;
            }
            else if (!activeHere && hotkeysRegistered)
            {
                UnregisterHotKey(Handle, HotkeyFullscreenId);
                UnregisterHotKey(Handle, HotkeyRelativeMouseMId);
                UnregisterHotKey(Handle, HotkeyRelativeMouseBackslashId);
                hotkeysRegistered = false;
            }
        }

        private void UpdateFullscreenBarAutoHide()
        {
            if (fullscreenBar == null || fullscreenBar.IsDisposed) return;
            if (!isFullScreen || WindowState == FormWindowState.Minimized || !IsAppForeground())
            {
                if (fullscreenBar.Visible) fullscreenBar.Hide();
                return;
            }

            Rectangle scr = Screen.FromControl(this).Bounds;
            Point cur = Cursor.Position;
            int barLeft = scr.Left + Math.Max(0, (scr.Width - fullscreenBar.Width) / 2);
            int barRight = barLeft + fullscreenBar.Width;
            bool inTopTrigger = cur.Y <= scr.Top + 4 && cur.X >= barLeft - 60 && cur.X <= barRight + 60;
            bool onBarArea = fullscreenBar.Visible && cur.Y <= scr.Top + fullscreenBar.Height + 12 &&
                             cur.X >= barLeft - 24 && cur.X <= barRight + 24;
            bool inInitialHint = DateTime.UtcNow < hintBarUntilUtc;

            if (inTopTrigger || onBarArea || inInitialHint)
            {
                barHideDeadlineUtc = DateTime.UtcNow.AddMilliseconds(400);
                ShowFullscreenBar();
            }
            else if (fullscreenBar.Visible && DateTime.UtcNow >= barHideDeadlineUtc)
            {
                fullscreenBar.Hide();
            }
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.F11)
            {
                ToggleFullScreen();
                return true;
            }
            if (keyData == Keys.F9)
            {
                ToggleNativeRelativeMouse(false);
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WmHotkey)
            {
                int id = m.WParam.ToInt32();
                if (id == HotkeyFullscreenId)
                {
                    ToggleFullScreen();
                    return;
                }
                if (id == HotkeyRelativeMouseMId || id == HotkeyRelativeMouseBackslashId)
                {
                    ToggleNativeRelativeMouse(false);
                    return;
                }
            }
            base.WndProc(ref m);
        }

        private void StartAutomatedTestSequence()
        {
            var timer = new Timer { Interval = 5000 };
            int phase = 0;
            timer.Tick += delegate
            {
                phase++;
                if (launchOptions.TestToggleRelative)
                {
                    if (phase == 1)
                    {
                        FocusRdpHost();
                        testRelBefore = IsNativeRelativeMouseCaptured().ToString();
                        ToggleNativeRelativeMouse(false);
                        timer.Interval = 500;
                        return;
                    }
                    if (phase == 2)
                    {
                        testRelAfterOn = IsNativeRelativeMouseCaptured().ToString();
                        ToggleNativeRelativeMouse(false);
                        timer.Interval = 500;
                        return;
                    }
                    if (phase == 3)
                    {
                        timer.Stop();
                        testRelAfterOff = IsNativeRelativeMouseCaptured().ToString();
                        WriteDiagnostics("ToggleRelativeTest", false);
                        Close();
                        return;
                    }
                }

                if (phase == 1)
                {
                    WriteDiagnostics("Initial", false);
                    if (!string.IsNullOrEmpty(launchOptions.SoftwareCaptureFullscreenPath))
                    {
                        CaptureFormPng(launchOptions.SoftwareCaptureFullscreenPath);
                    }

                    if (!string.IsNullOrEmpty(launchOptions.SoftwareCaptureWindowedPath))
                    {
                        SetFullScreen(false, true);
                        timer.Interval = 1200;
                        return;
                    }

                    timer.Stop();
                    return;
                }

                if (phase == 2)
                {
                    timer.Stop();
                    WriteDiagnostics("Windowed", true);
                    CaptureFormPng(launchOptions.SoftwareCaptureWindowedPath);
                    Close();
                }
            };
            timer.Start();
        }

        private void CaptureFormPng(string outPath)
        {
            try
            {
                string dir = Path.GetDirectoryName(outPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                int w = Math.Max(1, Width);
                int h = Math.Max(1, Height);
                using (var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        IntPtr hdc = g.GetHdc();
                        PrintWindow(Handle, hdc, 2);
                        g.ReleaseHdc(hdc);
                    }
                    bmp.Save(outPath, ImageFormat.Png);
                }
            }
            catch { }
        }

        private string FindChildOutputPainterRect()
        {
            if (!IsHandleCreated) return "no-handle";
            var found = new List<string>();
            EnumChildWindows(Handle, (ch, lp) =>
            {
                var sb = new StringBuilder(128);
                GetClassName(ch, sb, 128);
                string cls = sb.ToString();
                if (cls == "OPWindowClass" || cls == "OPContainerClass" || cls == "IHWindowClass")
                {
                    RECT r;
                    GetWindowRect(ch, out r);
                    found.Add(string.Format("{0}[vis={1}]:{2}x{3}", cls, IsWindowVisible(ch), r.Right - r.Left, r.Bottom - r.Top));
                }
                return true;
            }, IntPtr.Zero);
            return found.Count > 0 ? string.Join(", ", found.ToArray()) : "none";
        }

        private void WriteDiagnostics(string section, bool append)
        {
            if (string.IsNullOrEmpty(launchOptions.DiagnosticsPath)) return;
            try
            {
                string dir = Path.GetDirectoryName(launchOptions.DiagnosticsPath);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);

                IntPtr ihHwnd = FindInputHandlerWindow();
                uint ihPid = 0;
                uint ihTid = ihHwnd != IntPtr.Zero ? GetWindowThreadProcessId(ihHwnd, out ihPid) : 0;
                uint uiTid = GetCurrentThreadId();

                var lines = new List<string>();
                lines.Add("=== " + section + " ===");
                lines.Add("CLSID=" + activeClsid);
                lines.Add("IsFullScreen=" + isFullScreen);
                lines.Add("WindowState=" + WindowState);
                lines.Add("FormBounds=" + Bounds.Width + "x" + Bounds.Height);
                lines.Add("RdpAxBounds=" + (rdpAx != null ? (rdpAx.Width + "x" + rdpAx.Height) : "null"));
                lines.Add("ChildWindows=" + FindChildOutputPainterRect());
                try { lines.Add("Connected=" + ocx.Connected); } catch (Exception ex) { lines.Add("ConnectedErr=" + ex.Message); }
                try { lines.Add("SmartSizing=" + adv.SmartSizing); } catch (Exception ex) { lines.Add("SmartSizingErr=" + ex.Message); }
                try { lines.Add("AdvRelativeMouseMode=" + adv.RelativeMouseMode); } catch (Exception ex) { lines.Add("AdvRelativeMouseModeErr=" + ex.Message); }
                lines.Add("NativeRelativeMouseCaptured=" + IsNativeRelativeMouseCaptured());
                lines.Add("KeyboardHookMode=" + activeKeyboardHookMode);
                lines.Add("HotkeysRegistered=" + hotkeysRegistered);
                lines.Add("MouseInputModeRelative=" + (lastMouseModeRelative.HasValue ? lastMouseModeRelative.Value.ToString() : "unset"));
                lines.Add("ExtAllowRelativeMouseMode=" + GetExtProperty("AllowRelativeMouseMode"));
                lines.Add("ExtEnableHardwareMode=" + GetExtProperty("EnableHardwareMode"));
                lines.Add("ExtZoomLevel=" + GetExtProperty("ZoomLevel"));
                lines.Add("DesktopWidth=" + ocx.DesktopWidth + " DesktopHeight=" + ocx.DesktopHeight);
                lines.Add("IHWindowHwnd=0x" + ihHwnd.ToInt64().ToString("X"));
                lines.Add("IHThreadId=" + ihTid);
                lines.Add("UiThreadId=" + uiTid);
                lines.Add("RelBefore=" + testRelBefore);
                lines.Add("RelAfterOn=" + testRelAfterOn);
                lines.Add("RelAfterOff=" + testRelAfterOff);

                if (append && File.Exists(launchOptions.DiagnosticsPath))
                {
                    File.AppendAllLines(launchOptions.DiagnosticsPath, lines.ToArray(), Encoding.UTF8);
                }
                else
                {
                    File.WriteAllLines(launchOptions.DiagnosticsPath, lines.ToArray(), Encoding.UTF8);
                }
            }
            catch { }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (watcherTimer != null)
            {
                watcherTimer.Stop();
                watcherTimer.Dispose();
            }
            if (hotkeysRegistered && IsHandleCreated)
            {
                UnregisterHotKey(Handle, HotkeyFullscreenId);
                UnregisterHotKey(Handle, HotkeyRelativeMouseMId);
                UnregisterHotKey(Handle, HotkeyRelativeMouseBackslashId);
                hotkeysRegistered = false;
            }
            if (fullscreenBar != null && !fullscreenBar.IsDisposed)
            {
                fullscreenBar.Close();
                fullscreenBar.Dispose();
            }
            if (eventConnectionPoint != null && eventCookie != 0)
            {
                try { eventConnectionPoint.Unadvise(eventCookie); } catch { }
                eventCookie = 0;
                eventConnectionPoint = null;
            }
            if (ocx != null)
            {
                try
                {
                    if ((int)ocx.Connected != 0)
                    {
                        ocx.Disconnect();
                    }
                }
                catch { }
            }
        }

        private static void EnableDpiAwareness()
        {
            try
            {
                if (!SetProcessDpiAwarenessContext((IntPtr)(-4)))
                {
                    SetProcessDPIAware();
                }
            }
            catch
            {
                try { SetProcessDPIAware(); } catch { }
            }
        }

        private static ClientLaunchOptions ParseArgs(string[] args)
        {
            var opts = new ClientLaunchOptions();
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (string.Equals(a, "--windowed", StringComparison.OrdinalIgnoreCase))
                {
                    opts.StartWindowed = true;
                }
                else if (string.Equals(a, "--test-toggle-relative", StringComparison.OrdinalIgnoreCase))
                {
                    opts.TestToggleRelative = true;
                }
                else if (string.Equals(a, "--test-diagnostics", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    opts.DiagnosticsPath = args[++i];
                }
                else if (string.Equals(a, "--test-software-capture", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    opts.SoftwareCaptureFullscreenPath = args[++i];
                }
                else if (string.Equals(a, "--test-capture-windowed", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    opts.SoftwareCaptureWindowedPath = args[++i];
                }
            }
            return opts;
        }

        [STAThread]
        public static void Main(string[] args)
        {
            EnableDpiAwareness();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new RdpBotForm(ParseArgs(args)));
        }
    }
}
