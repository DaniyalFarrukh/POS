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

export * from './uuid';
export * from './schema';
export * from './schema/product';
export * from './csv/parser';
export * from './csv/validator';
