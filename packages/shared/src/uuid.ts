import { uuidv7 } from 'uuidv7';

export function generateUuidV7(): string {
  return uuidv7();
}

const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuidV7(id: string): boolean {
  return UUID_V7_REGEX.test(id);
}
