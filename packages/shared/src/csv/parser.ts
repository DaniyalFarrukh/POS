/**
 * RFC 4180 compliant CSV parser written in pure TypeScript.
 * Accurately handles:
 * - Quoted fields with commas (e.g. "Amoxicillin, Clavulanic Acid")
 * - Escaped double quotes inside quoted fields ("Capsule ""XL""")
 * - Embedded newlines inside quotes
 * - Mixed line endings (\r\n and \n)
 * - Trailing blank lines
 */

export interface ParseCsvOptions {
  delimiter?: string;
  trim?: boolean;
}

export function parseCsv(text: string, options: ParseCsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  const shouldTrim = options.trim ?? true;

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const nextChar = i + 1 < len ? text[i + 1] : '';

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        // Any character inside quotes
        currentField += char;
        i++;
        continue;
      }
    } else {
      // Outside of quotes
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === delimiter) {
        currentRow.push(shouldTrim ? currentField.trim() : currentField);
        currentField = '';
        i++;
        continue;
      } else if (char === '\r') {
        // Handle CRLF or standalone CR
        if (nextChar === '\n') {
          i++;
        }
        currentRow.push(shouldTrim ? currentField.trim() : currentField);
        currentField = '';
        // Only push non-empty rows
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else if (char === '\n') {
        // Standalone LF
        currentRow.push(shouldTrim ? currentField.trim() : currentField);
        currentField = '';
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else {
        currentField += char;
        i++;
      }
    }
  }

  // Handle final row and field
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(shouldTrim ? currentField.trim() : currentField);
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: Unclosed quote detected in input.');
  }

  return rows;
}
