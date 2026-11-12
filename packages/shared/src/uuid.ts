import { uuidv7 } from 'uuidv7';

export const generateUuidV7: () => string = uuidv7;

const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuidV7(id: string): boolean {
  return UUID_V7_REGEX.test(id);
}

export function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}
