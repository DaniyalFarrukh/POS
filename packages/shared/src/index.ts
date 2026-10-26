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
export * from './money';
export * from './tax';
export * from './schema';
export * from './schema/product';
export * from './schema/purchasing';
export * from './csv/parser';
export * from './csv/validator';
export * from './fefo';
export * from './schema/sync';
