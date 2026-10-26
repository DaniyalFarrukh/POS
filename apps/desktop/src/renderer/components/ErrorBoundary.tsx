import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { TRANSLATIONS, type SupportedLocale } from '../utils/i18n/translations';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  exporting: boolean;
  exportResult: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      exporting: false,
      exportResult: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Unhandled UI Crash:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleExportDiagnostics = async (): Promise<void> => {
    if (!window.api?.system?.exportDiagnostics) return;
    this.setState({ exporting: true, exportResult: null });
    try {
      const res = await window.api.system.exportDiagnostics();
      if (res.success && res.zipPath) {
        this.setState({ exportResult: `Diagnostics saved: ${res.zipPath}` });
      } else {
        this.setState({ exportResult: `Export failed: ${res.error || 'Unknown error'}` });
      }
    } catch (err: unknown) {
      this.setState({ exportResult: `Export error: ${String(err)}` });
    } finally {
      this.setState({ exporting: false });
    }
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      // Determine locale from stored preference or fallback
      let locale: SupportedLocale = 'en';
      try {
        const saved = localStorage.getItem('pos_locale_preference');
        if (saved === 'ur' || saved === 'en') locale = saved;
      } catch {
        // Fallback
      }
      const t = TRANSLATIONS[locale] || TRANSLATIONS.en;
      const isRtl = locale === 'ur';

      return (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0f172a',
            color: '#f8fafc',
            padding: '24px',
            fontFamily: isRtl
              ? "'Noto Nastaliq Urdu', -apple-system, sans-serif"
              : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <div
            style={{
              maxWidth: '680px',
              width: '100%',
              backgroundColor: '#1e293b',
              borderRadius: '12px',
              border: '1px solid #334155',
              padding: '32px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
            }}
          >
            {/* Warning Icon & Heading */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '10px',
                  backgroundColor: '#fee2e2',
                  color: '#dc2626',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  fontWeight: 'bold',
                  flexShrink: 0,
                }}
              >
                ⚠
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#f8fafc' }}>
                  {t.crashTitle}
                </h1>
                <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#94a3b8' }}>
                  {t.crashSubtitle}
                </p>
              </div>
            </div>

            <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#cbd5e1', marginBottom: '24px' }}>
              {t.crashAdvice}
            </p>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px' }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🔄 {t.reloadApp}
              </button>

              <button
                type="button"
                onClick={this.handleExportDiagnostics}
                disabled={this.state.exporting}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#334155',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: this.state.exporting ? 'wait' : 'pointer',
                }}
              >
                {this.state.exporting ? 'Exporting...' : `📦 ${t.exportCrashLog}`}
              </button>
            </div>

            {this.state.exportResult && (
              <div
                style={{
                  padding: '10px 14px',
                  backgroundColor: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '13px',
                  color: '#38bdf8',
                  marginBottom: '20px',
                  wordBreak: 'break-all',
                }}
              >
                {this.state.exportResult}
              </div>
            )}

            {/* Expandable Technical Details */}
            <details
              style={{
                backgroundColor: '#0f172a',
                borderRadius: '6px',
                border: '1px solid #334155',
                padding: '12px',
                fontSize: '12px',
                color: '#94a3b8',
              }}
            >
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#cbd5e1' }}>
                {t.technicalDetails}
              </summary>
              <div
                className="ltr-override"
                style={{
                  marginTop: '12px',
                  fontFamily: 'Consolas, monospace',
                  whiteSpace: 'pre-wrap',
                  overflowX: 'auto',
                  direction: 'ltr',
                  textAlign: 'left',
                  color: '#f87171',
                }}
              >
                <strong>{this.state.error?.toString()}</strong>
                {this.state.errorInfo?.componentStack}
              </div>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
