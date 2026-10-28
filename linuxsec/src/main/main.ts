import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SettingsStore } from './storage/SettingsStore';
import { ProfileStore } from './storage/ProfileStore';
import { HistoryStore } from './storage/HistoryStore';
import { PublicIpService } from './vpn/PublicIpService';
import { PingService } from './vpn/PingService';
import { DiagnosticEngine } from './vpn/DiagnosticEngine';
import { VpnCoordinator } from './vpn/VpnCoordinator';
import { AutostartManager } from './system/AutostartManager';
import { TrayManager } from './system/TrayManager';
import { registerIpcHandlers } from './ipc/registerIpc';

// Security check: NEVER run full Electron renderer with UID 0
if (process.getuid && process.getuid() === 0) {
  console.error('[SECURITY FATAL] Linuxsec GUI must NOT be run as root. Privileged operations are delegated to linuxsecd.');
  process.exit(1);
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let vpnCoordinator: VpnCoordinator | null = null;
let trayManager: TrayManager | null = null;

async function createWindow() {
  const userDataPath = app.getPath('userData');
  const settingsStore = new SettingsStore(userDataPath);
  const profileStore = new ProfileStore(userDataPath);
  const historyStore = new HistoryStore(userDataPath);
  const publicIpService = new PublicIpService();
  const pingService = new PingService();
  const diagnosticEngine = new DiagnosticEngine(publicIpService, pingService);
  const autostartManager = new AutostartManager();

  vpnCoordinator = new VpnCoordinator(settingsStore, historyStore, publicIpService);

  const preloadPath = path.join(__dirname, '../preload/preload.js');

  mainWindow = new BrowserWindow({
    width: 440,
    height: 720,
    minWidth: 400,
    minHeight: 640,
    title: 'Linuxsec VPN',
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Strict CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.ipify.org https://ipapi.co https://icanhazip.com;"
        ],
      },
    });
  });

  registerIpcHandlers(
    mainWindow,
    vpnCoordinator,
    profileStore,
    settingsStore,
    diagnosticEngine,
    publicIpService,
    pingService,
    autostartManager
  );

  trayManager = new TrayManager(mainWindow, vpnCoordinator);

  // Load renderer
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    const isHiddenStart = process.argv.includes('--hidden');
    if (!isHiddenStart && mainWindow) {
      mainWindow.show();
    }

    // Auto-connect if enabled
    const settings = settingsStore.getSettings();
    if (settings.autoConnectOnStart && vpnCoordinator) {
      const defaultServer = settings.defaultServerId
        ? profileStore.getById(settings.defaultServerId)
        : profileStore.getAll()[0];
      if (defaultServer) {
        vpnCoordinator.connect(defaultServer).catch((err) => {
          console.warn('[Linuxsec] Auto-connect failed:', err);
        });
      }
    }
  });

  mainWindow.on('close', (e) => {
    if (!(app as any).isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

// App lifecycle
app.whenReady().then(createWindow);

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

let isShuttingDown = false;
app.on('before-quit', async (event) => {
  (app as any).isQuitting = true;
  if (!isShuttingDown && vpnCoordinator) {
    isShuttingDown = true;
    event.preventDefault();
    try {
      await vpnCoordinator.shutdown();
    } catch (e) {
      console.warn('[Linuxsec] Shutdown cleanup warning:', e);
    }
    trayManager?.destroy();
    app.exit(0);
  }
});

// Process signal traps for safe cleanup
process.on('SIGINT', async () => {
  if (vpnCoordinator) {
    await vpnCoordinator.shutdown().catch(() => {});
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (vpnCoordinator) {
    await vpnCoordinator.shutdown().catch(() => {});
  }
  process.exit(0);
});
