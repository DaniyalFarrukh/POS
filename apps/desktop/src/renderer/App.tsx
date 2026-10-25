import { useEffect, useState } from 'react';
import { getSharedInfo } from '@pos/shared';
import type { DbMetadata } from '../preload/index.d';

export function App() {
  const [pingStatus, setPingStatus] = useState<string>('Sending ping...');
  const [dbInfo, setDbInfo] = useState<DbMetadata | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const shared = getSharedInfo();

  useEffect(() => {
    if (window.api) {
      if (typeof window.api.ping === 'function') {
        window.api
          .ping()
          .then((response: string) => {
            setPingStatus(response);
          })
          .catch((error: unknown) => {
            setPingStatus(`Error: ${String(error)}`);
          });
      }

      if (typeof window.api.getDbInfo === 'function') {
        window.api
          .getDbInfo()
          .then((info: DbMetadata) => {
            setDbInfo(info);
          })
          .catch((error: unknown) => {
            setDbError(`DB Error: ${String(error)}`);
          });
      }
    } else {
      setPingStatus('window.api not available (browser mode)');
    }
  }, []);

  return (
    <main
      style={{
        padding: '32px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: '#111827',
        backgroundColor: '#ffffff',
        minHeight: '100vh',
        boxSizing: 'border-box',
      }}
    >
      <header
        style={{
          marginBottom: '28px',
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: '16px',
        }}
      >
        <h1 style={{ margin: 0, fontSize: '28px', fontWeight: 700, color: '#111827' }}>
          {shared.appName} Counter Terminal
        </h1>
        <p style={{ margin: '8px 0 0 0', color: '#6b7280', fontSize: '14px' }}>
          System Version {shared.version} ({shared.environment}) • Target Resolution 1366×768
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', maxWidth: '780px' }}>
        {/* IPC Status Card */}
        <section
          style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px 24px',
          }}
        >
          <h2 style={{ margin: '0 0 12px 0', fontSize: '17px', fontWeight: 600, color: '#374151' }}>
            IPC Bridge Communication
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 500, fontSize: '14px' }}>Round-trip IPC ping():</span>
            <span
              id="ping-result"
              style={{
                padding: '4px 14px',
                borderRadius: '9999px',
                fontWeight: 600,
                fontSize: '13px',
                backgroundColor: pingStatus === 'pong' ? '#dcfce7' : '#fee2e2',
                color: pingStatus === 'pong' ? '#166534' : '#991b1b',
                border: pingStatus === 'pong' ? '1px solid #86efac' : '1px solid #fca5a5',
              }}
            >
              {pingStatus}
            </span>
          </div>
        </section>

        {/* Database Status Card */}
        <section
          style={{
            background: '#f9fafb',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '20px 24px',
          }}
        >
          <h2 style={{ margin: '0 0 16px 0', fontSize: '17px', fontWeight: 600, color: '#374151' }}>
            Local SQLite Database & Migrations
          </h2>

          {dbError && (
            <div
              style={{
                padding: '12px',
                borderRadius: '6px',
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                marginBottom: '12px',
                fontSize: '14px',
              }}
            >
              {dbError}
            </div>
          )}

          {dbInfo ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#4b5563' }}>
                  Database Path:
                </span>
                <div
                  id="db-path"
                  style={{
                    marginTop: '4px',
                    fontFamily: 'Consolas, monospace',
                    fontSize: '13px',
                    padding: '8px 12px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    wordBreak: 'break-all',
                    color: '#1f2937',
                  }}
                >
                  {dbInfo.dbPath}
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#4b5563' }}>
                    Schema Version:
                  </span>
                  <span
                    id="schema-version"
                    style={{
                      padding: '2px 10px',
                      backgroundColor: '#e0e7ff',
                      color: '#3730a3',
                      fontWeight: 700,
                      borderRadius: '4px',
                      fontSize: '13px',
                    }}
                  >
                    v{dbInfo.schemaVersion}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#4b5563' }}>
                    Journal Mode:
                  </span>
                  <span
                    id="journal-mode"
                    style={{
                      padding: '2px 10px',
                      backgroundColor:
                        dbInfo.journalMode.toLowerCase() === 'wal' ? '#dcfce7' : '#fee2e2',
                      color: dbInfo.journalMode.toLowerCase() === 'wal' ? '#166534' : '#991b1b',
                      fontWeight: 700,
                      borderRadius: '4px',
                      fontSize: '13px',
                    }}
                  >
                    {dbInfo.journalMode.toUpperCase()}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#4b5563' }}>
                    Foreign Keys:
                  </span>
                  <span
                    id="foreign-keys"
                    style={{
                      padding: '2px 10px',
                      backgroundColor: dbInfo.foreignKeys ? '#dcfce7' : '#fee2e2',
                      color: dbInfo.foreignKeys ? '#166534' : '#991b1b',
                      fontWeight: 700,
                      borderRadius: '4px',
                      fontSize: '13px',
                    }}
                  >
                    {dbInfo.foreignKeys ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ color: '#6b7280', fontSize: '14px' }}>Initializing database...</div>
          )}
        </section>
      </div>
    </main>
  );
}
