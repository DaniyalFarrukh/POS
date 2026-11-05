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
export * from './time';
export * from './phone';
export * from './schema/prescription';
export * from './schema/hr';
export * from './schema/payroll';
export * from './schema/sync';
export * from './schema/dashboard';
export * from './schema/notifications';
export { z } from 'zod';
