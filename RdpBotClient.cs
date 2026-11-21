using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
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

    internal sealed class RdpAxControl : AxHost
    {
        public RdpAxControl(string clsid) : base(clsid) { }

        public object Ocx
        {
            get { return GetOcx(); }
        }
    }

    public sealed class RdpBotForm : Form
    {
        private const int RemoteWidth = 960;
        private const int RemoteHeight = 600;
        private const int ToolbarHeight = 30;
        private const int PerfDisableBase = 0x0F; // wallpaper + fullwindowdrag + menuanims + theming disabled; font smoothing + desktop comp off
        private const uint ModControlAlt = 0x0001 | 0x0002;
        private const int HotkeyFullscreenId = 101;
        private const int HotkeyRelativeMouseId = 102;
        private const int WmHotkey = 0x0312;

        private static readonly string[] CandidateClsids = new[]
        {
            "1df7c823-b2d4-4b54-975a-f2ac5d7cf8b8", // MsRdpClient11NotSafeForScripting
            "a0c63c30-f08d-4ab4-907c-34905d770c7d", // MsRdpClient10NotSafeForScripting
            "8b918b82-7985-4c24-89df-c33ad2bbfbcd"  // MsRdpClient9NotSafeForScripting
        };

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

        private readonly string diagLogPath;
        private readonly Panel toolbarPanel;
        private readonly Button btnFullscreen;
        private readonly Button btnRelativeMouse;
        private readonly Button btnScaleMode;
        private readonly Label lblStatus;
        private readonly Panel rdpHostPanel;

        private RdpAxControl rdpAx;
        private dynamic ocx;
        private dynamic adv;
        private IMsRdpExtendedSettings extSettings;
        private string activeClsid = "";
        private bool relativeMouseEnabled = true;
        private bool fillWindowMode = true;
        private bool isFullScreen = false;
        private bool hotkeysRegistered = false;
        private FormBorderStyle savedBorderStyle = FormBorderStyle.Sizable;
        private FormWindowState savedWindowState = FormWindowState.Maximized;
        private Rectangle savedBounds;
        private Timer focusWatcher;

        public RdpBotForm(string diagnosticsPath)
        {
            diagLogPath = diagnosticsPath;

            Text = "BotUser (960x600) - Sessao RDP";
            BackColor = Color.Black;
            StartPosition = FormStartPosition.Manual;
            WindowState = FormWindowState.Maximized;
            MinimumSize = new Size(480, 340);
            KeyPreview = true;

            toolbarPanel = new Panel
            {
                Dock = DockStyle.Top,
                Height = ToolbarHeight,
                BackColor = Color.FromArgb(24, 24, 28),
                Padding = new Padding(6, 3, 6, 3)
            };

            btnFullscreen = CreateToolbarButton("Tela Cheia (Ctrl+Alt+Enter)", 185);
            btnFullscreen.Click += delegate { ToggleFullScreen(); };

            btnRelativeMouse = CreateToolbarButton("Mouse Relativo: ON (Ctrl+Alt+M)", 215);
            btnRelativeMouse.Click += delegate { ToggleRelativeMouse(); };

            btnScaleMode = CreateToolbarButton("Escala: Preencher", 130);
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

            Load += OnFormLoad;
            FormClosing += OnFormClosing;
        }

        private static Button CreateToolbarButton(string text, int width)
        {
            return new Button
            {
                Text = text,
                Width = width,
                Height = 23,
                FlatStyle = FlatStyle.Flat,
                ForeColor = Color.White,
                BackColor = Color.FromArgb(46, 50, 60),
                Font = new Font("Segoe UI", 8.2f),
                Margin = new Padding(0, 0, 6, 0),
                TabStop = false
            };
        }

        private void OnFormLoad(object sender, EventArgs e)
        {
            InitializeRdpControl();
            UpdateButtonsAndStatus();

            focusWatcher = new Timer { Interval = 250 };
            focusWatcher.Tick += delegate { SyncHotkeysWithForeground(); };
            focusWatcher.Start();

            if (!string.IsNullOrEmpty(diagLogPath))
            {
                var diagTimer = new Timer { Interval = 4500 };
                diagTimer.Tick += delegate
                {
                    diagTimer.Stop();
                    WriteDiagnostics();
                };
                diagTimer.Start();
            }
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

            LayoutRdpControl();
            ConfigureAndConnect();
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
                TrySet(() => adv.NegotiateSecurityLayer = false);
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
                TrySet(() => adv.RelativeMouseMode = relativeMouseEnabled);
                TrySet(() => adv.NetworkConnectionType = 6u);
            }

            TrySet(() => { ocx.SecuredSettings2.AudioRedirectionMode = 2; });
            TrySet(() => { ocx.SecuredSettings2.KeyboardHookMode = 1; });

            extSettings = ocx as IMsRdpExtendedSettings;
            if (extSettings != null)
            {
                SetExtProperty("AllowRelativeMouseMode", true);
                SetExtProperty("HighResolutionMouse", true);
                SetExtProperty("High Resolution Mouse", true);
                SetExtProperty("IgnoreServerGeneratedMouseMoves", false);
                SetExtProperty("DynamicResolution", false);
                SetExtProperty("EnableZoom", true);
            }

            ocx.Connect();
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
            if (!isFullScreen)
            {
                savedBorderStyle = FormBorderStyle;
                savedWindowState = WindowState;
                savedBounds = Bounds;

                toolbarPanel.Visible = false;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;
                Bounds = Screen.FromControl(this).Bounds;
                isFullScreen = true;
            }
            else
            {
                isFullScreen = false;
                FormBorderStyle = savedBorderStyle;
                toolbarPanel.Visible = true;
                WindowState = savedWindowState;
                if (savedWindowState == FormWindowState.Normal && savedBounds.Width > 0)
                {
                    Bounds = savedBounds;
                }
            }
            LayoutRdpControl();
            FocusRdpHost();
        }

        private void ToggleRelativeMouse()
        {
            relativeMouseEnabled = !relativeMouseEnabled;
            if (adv != null)
            {
                TrySet(() => adv.RelativeMouseMode = relativeMouseEnabled);
            }
            UpdateButtonsAndStatus();
            FocusRdpHost();
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
                btnRelativeMouse.Text = relativeMouseEnabled
                    ? "Mouse Relativo: ON (Ctrl+Alt+M)"
                    : "Mouse Relativo: OFF (Ctrl+Alt+M)";
                btnRelativeMouse.BackColor = relativeMouseEnabled
                    ? Color.FromArgb(38, 108, 68)
                    : Color.FromArgb(72, 52, 52);
            }
            if (btnScaleMode != null)
            {
                btnScaleMode.Text = fillWindowMode ? "Escala: Preencher" : "Escala: 16:10";
            }
            if (btnFullscreen != null)
            {
                btnFullscreen.Text = isFullScreen
                    ? "Sair Tela Cheia (Ctrl+Alt+Enter)"
                    : "Tela Cheia (Ctrl+Alt+Enter)";
            }
            if (lblStatus != null && rdpAx != null)
            {
                lblStatus.Text = string.Format("Interno: {0}x{1} -> Janela: {2}x{3} | Ctrl+Alt+\\ libera mouse",
                    RemoteWidth, RemoteHeight, rdpAx.Width, rdpAx.Height);
            }
        }

        private void SyncHotkeysWithForeground()
        {
            if (!IsHandleCreated || IsDisposed) return;
            IntPtr fg = GetForegroundWindow();
            bool activeHere = (fg == Handle) || (fg != IntPtr.Zero && IsChild(Handle, fg));
            if (activeHere && !hotkeysRegistered)
            {
                bool ok1 = RegisterHotKey(Handle, HotkeyFullscreenId, ModControlAlt, (uint)Keys.Return);
                bool ok2 = RegisterHotKey(Handle, HotkeyRelativeMouseId, ModControlAlt, (uint)Keys.M);
                hotkeysRegistered = ok1 || ok2;
            }
            else if (!activeHere && hotkeysRegistered)
            {
                UnregisterHotKey(Handle, HotkeyFullscreenId);
                UnregisterHotKey(Handle, HotkeyRelativeMouseId);
                hotkeysRegistered = false;
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
                ToggleRelativeMouse();
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
                if (id == HotkeyRelativeMouseId)
                {
                    ToggleRelativeMouse();
                    return;
                }
            }
            base.WndProc(ref m);
        }

        private void WriteDiagnostics()
        {
            try
            {
                var lines = new List<string>();
                lines.Add("CLSID=" + activeClsid);
                lines.Add("FormBounds=" + Bounds.Width + "x" + Bounds.Height);
                lines.Add("RdpAxBounds=" + (rdpAx != null ? (rdpAx.Width + "x" + rdpAx.Height) : "null"));
                try { lines.Add("Connected=" + ocx.Connected); } catch (Exception ex) { lines.Add("ConnectedErr=" + ex.Message); }
                try { lines.Add("SmartSizing=" + adv.SmartSizing); } catch (Exception ex) { lines.Add("SmartSizingErr=" + ex.Message); }
                try { lines.Add("RelativeMouseMode=" + adv.RelativeMouseMode); } catch (Exception ex) { lines.Add("RelativeMouseModeErr=" + ex.Message); }
                lines.Add("ExtAllowRelativeMouseMode=" + GetExtProperty("AllowRelativeMouseMode"));
                lines.Add("ExtZoomLevel=" + GetExtProperty("ZoomLevel"));
                lines.Add("DesktopWidth=" + ocx.DesktopWidth + " DesktopHeight=" + ocx.DesktopHeight);
                File.WriteAllLines(diagLogPath, lines.ToArray(), Encoding.UTF8);
            }
            catch { }
        }

        private void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (focusWatcher != null)
            {
                focusWatcher.Stop();
                focusWatcher.Dispose();
            }
            if (hotkeysRegistered && IsHandleCreated)
            {
                UnregisterHotKey(Handle, HotkeyFullscreenId);
                UnregisterHotKey(Handle, HotkeyRelativeMouseId);
                hotkeysRegistered = false;
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

        [STAThread]
        public static void Main(string[] args)
        {
            EnableDpiAwareness();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string diag = null;
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--test-diagnostics")
                {
                    diag = args[i + 1];
                    break;
                }
            }

            Application.Run(new RdpBotForm(diag));
        }
    }
}
