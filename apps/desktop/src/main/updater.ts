import { app, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { logInfo, logWarn, logError } from './logger';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  updateVersion?: string;
  releaseDate?: string;
  error?: string;
}

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'error';

let currentStatus: UpdateStatus = 'idle';
let lastCheckedAt: string | undefined;

/**
 * Initializes electron-updater pointing to the configured releases endpoint.
 * Note: Uses placeholder endpoint for production distribution updates.
 */
export function initAutoUpdater(mainWindow?: BrowserWindow): void {
  // Never auto-download updates without explicit confirmation
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Placeholder URL documented for the pharmacy enterprise deployment
  // In production, this points to your self-hosted or S3/MinIO releases bucket.
  const feedUrl =
    process.env.POS_UPDATE_FEED_URL ||
    'https://updates.pos-pharmacy.local/releases/win/';

  try {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
    });
    logInfo('Updater', `Auto-updater initialized with feed URL: ${feedUrl}`);
  } catch (err) {
    logWarn('Updater', `Could not set auto-updater feed URL: ${err}`);
  }

  autoUpdater.on('checking-for-update', () => {
    currentStatus = 'checking';
    lastCheckedAt = new Date().toISOString();
    logInfo('Updater', 'Checking for software updates...');
    mainWindow?.webContents.send('updater:status', { status: currentStatus });
  });

  autoUpdater.on('update-available', (info) => {
    currentStatus = 'available';
    logInfo('Updater', `Update available: ${info.version}`);
    mainWindow?.webContents.send('updater:status', {
      status: currentStatus,
      version: info.version,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    currentStatus = 'not-available';
    logInfo('Updater', `App is up-to-date (v${info.version})`);
    mainWindow?.webContents.send('updater:status', { status: currentStatus });
  });

  autoUpdater.on('error', (err) => {
    currentStatus = 'error';
    logError('Updater', `Auto-updater check encountered error: ${err.message}`);
    mainWindow?.webContents.send('updater:status', {
      status: currentStatus,
      error: err.message,
    });
  });
}

/**
 * Manually checks for updates and returns result to the renderer.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app ? app.getVersion() : '0.1.0';

  // If in packaged mode or test mode
  try {
    currentStatus = 'checking';
    lastCheckedAt = new Date().toISOString();
    const result = await autoUpdater.checkForUpdates();

    if (result && result.updateInfo) {
      const isAvailable = result.updateInfo.version !== currentVersion;
      currentStatus = isAvailable ? 'available' : 'not-available';
      return {
        updateAvailable: isAvailable,
        currentVersion,
        updateVersion: result.updateInfo.version,
        releaseDate: result.updateInfo.releaseDate,
      };
    }

    currentStatus = 'not-available';
    return {
      updateAvailable: false,
      currentVersion,
    };
  } catch (err: unknown) {
    currentStatus = 'error';
    const errorMsg = err instanceof Error ? err.message : String(err);
    logWarn('Updater', `Update check returned notice: ${errorMsg}`);
    return {
      updateAvailable: false,
      currentVersion,
      error: `Update server placeholder unreachable (${errorMsg}). Offline operation unaffected.`,
    };
  }
}

export function getUpdaterStatus(): {
  currentVersion: string;
  status: UpdateStatus;
  lastCheckedAt?: string;
} {
  return {
    currentVersion: app ? app.getVersion() : '0.1.0',
    status: currentStatus,
    lastCheckedAt,
  };
}
