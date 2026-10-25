export interface SharedInfo {
  appName: string;
  version: string;
  environment: string;
}

export function getSharedInfo(): SharedInfo {
  return {
    appName: 'POS',
    version: '0.1.0',
    environment: 'development',
  };
}
