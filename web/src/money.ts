const MINUS = '−';
const MAX_MINOR = 1e13; // field rules: no amount above 10^13 minor units

/** 123456 -> "1,234.56"; -4820 -> "−48.20". Integer maths only. */
export function formatMinor(minor: number): string {
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (abs % 100).toString().padStart(2, '0');
  return `${minor < 0 ? MINUS : ''}${whole}.${cents}`;
}

/** Same as formatMinor, for filling an input: no thousands separators, ASCII minus. */
export function minorToInput(minor: number): string {
  return formatMinor(minor).replace(/,/g, '').replace(MINUS, '-');
}

export const AMOUNT_ERROR = 'Enter an amount above zero, with at most two decimals.';

const AMOUNT = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/**
 * Text -> whole minor units, or null when the text is not an amount.
 * Accepts 12, 12.5, 12.50, 1,234.56. The digits are joined as a string, never multiplied as floats.
 * By default zero and negatives are rejected; budgets allow zero, opening balances allow both.
 */
export function parseAmount(text: string, opts: { allowZero?: boolean; allowNegative?: boolean } = {}): number | null {
  const m = AMOUNT.exec(text.trim().replace(MINUS, '-'));
  if (!m) return null;
  const [, sign, whole, frac = ''] = m;
  if (sign && !opts.allowNegative) return null;
  const minor = Number(whole.replace(/,/g, '') + frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return null;
  if (minor === 0 && !opts.allowZero) return null;
  return sign && minor !== 0 ? -minor : minor;
}

export const PERCENT_ERROR = 'Enter a percentage above 0 and up to 100, with at most two decimals.';

/** "2.5" -> 250 basis points; null unless above 0 and up to 100 with at most two decimals. The amount parser does the digits: two decimals times 100 is the same whole number. */
export function parsePercent(text: string): number | null {
  const bp = parseAmount(text);
  return bp === null || bp > 10000 ? null : bp;
}

/** 5000 -> "50", 250 -> "2.5", 1225 -> "12.25". */
export const percentText = (bp: number) => minorToInput(bp).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
