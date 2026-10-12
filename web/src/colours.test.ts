import { expect, test } from 'vitest';

// Every colour is a design token; a literal anywhere in web/src is a mistake.
const LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

const sources = import.meta.glob('./**/*.{ts,tsx,css}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

test('web/src has no colour literals', () => {
  const files = Object.keys(sources).filter((f) => f !== './colours.test.ts');
  expect(files.length).toBeGreaterThan(5);
  expect(sources['./app.css'].length).toBeGreaterThan(0);
  expect(files.filter((f) => LITERAL.test(sources[f]))).toEqual([]);
});
