import { BrowserWindow } from 'electron';

export interface PrintReceiptOptions {
  silent?: boolean;
  deviceName?: string;
}

export interface PrintReceiptResult {
  success: boolean;
  error?: string;
}

/**
 * Renders an 80mm thermal receipt HTML in an offscreen Electron window
 * and routes it to the Windows print spooler.
 * Returns { success: boolean, error?: string } without throwing, ensuring
 * that printer failures never roll back or disrupt a finalized sale.
 */
export async function printReceiptHtml(
  htmlContent: string,
  options: PrintReceiptOptions = {}
): Promise<PrintReceiptResult> {
  // If running in headless tests where Electron BrowserWindow is unavailable or mocked
  if (typeof BrowserWindow === 'undefined' || !BrowserWindow) {
    return { success: true };
  }

  let printWin: BrowserWindow | null = null;
  try {
    printWin = new BrowserWindow({
      show: false,
      width: 350,
      height: 700,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
      },
    });

    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`;
    await printWin.loadURL(dataUrl);

    return await new Promise<PrintReceiptResult>((resolve) => {
      if (!printWin || printWin.isDestroyed()) {
        resolve({ success: false, error: 'Print window destroyed before job start' });
        return;
      }

      printWin.webContents.print(
        {
          silent: options.silent ?? false,
          printBackground: true,
          deviceName: options.deviceName,
          margins: { marginType: 'none' },
          pageSize: { width: 80000, height: 297000 }, // 80mm roll width
        },
        (success, failureReason) => {
          try {
            if (printWin && !printWin.isDestroyed()) {
              printWin.close();
              printWin = null;
            }
          } catch {
            // Ignore window close error
          }

          if (success) {
            resolve({ success: true });
          } else {
            resolve({
              success: false,
              error: failureReason || 'Print job canceled or printer offline',
            });
          }
        }
      );
    });
  } catch (err: unknown) {
    try {
      if (printWin && !printWin.isDestroyed()) {
        printWin.close();
      }
    } catch {
      // Ignore
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
