import { describe, expect, it } from 'vitest';
import { formatMinor, minorToInput, parseAmount, parsePercent, percentText } from './money';

describe('formatMinor', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [41, '0.41'],
    [100, '1.00'],
    [117500, '1,175.00'],
    [123456, '1,234.56'],
    [100000000, '1,000,000.00'],
    [-4820, '−48.20'],
    [-5, '−0.05'],
    [-123456789, '−1,234,567.89'],
    [1e15, '10,000,000,000,000.00'],
  ])('%d -> %s', (n, s) => expect(formatMinor(n)).toBe(s));
});

describe('parseAmount accepts', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['1,234.56', 123456],
    ['1,234', 123400],
    ['0.01', 1],
    ['0.1', 10],
    ['  7.00  ', 700],
    ['007', 700],
    ['100000000000.00', 1e13],
  ])('%s -> %d', (s, n) => expect(parseAmount(s)).toBe(n));

  // Values where Math.round(parseFloat(s) * 100) is fragile (1.005 * 100 = 100.49999...).
  it.each([
    ['1.15', 115],
    ['4.35', 435],
    ['8.2', 820],
    ['19.99', 1999],
    ['0.29', 29],
    ['1.1', 110],
    ['0.57', 57],
    ['1,000.10', 100010],
  ])('float trap %s -> %d', (s, n) => expect(parseAmount(s)).toBe(n));

  it('is exact for every amount from 0.01 to 1,000.00', () => {
    for (let c = 1; c <= 100000; c++) {
      const text = `${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`;
      expect(parseAmount(text)).toBe(c);
    }
  });
});

describe('parseAmount rejects', () => {
  it.each([
    '', ' ', 'abc', '0', '0.00', '-5', '-0.01', '−5', '12.345', '12.', '.5', '1,23', '1,2345.00', ',123',
    '1,234,56', '12,5', '1 234', '1e3', '12.5.0', '+5', '12 EUR', '100000000000.01', '99999999999999999999',
  ])('"%s"', (s) => expect(parseAmount(s)).toBeNull());
});

describe('parseAmount options', () => {
  it('allowZero', () => {
    expect(parseAmount('0', { allowZero: true })).toBe(0);
    expect(parseAmount('0.00', { allowZero: true })).toBe(0);
    expect(parseAmount('-0', { allowZero: true, allowNegative: true })).toBe(0);
  });
  it('allowNegative', () => {
    expect(parseAmount('-12.5', { allowNegative: true })).toBe(-1250);
    expect(parseAmount('−1,234.56', { allowNegative: true })).toBe(-123456);
    expect(parseAmount('-0.01', { allowNegative: true })).toBe(-1);
    expect(parseAmount('-100000000000.01', { allowNegative: true })).toBeNull();
  });
});

describe('round trip', () => {
  it.each([0, 1, 99, 100, 117500, 123456, -4820, 1e13, -1e13])('%d', (n) => {
    const opts = { allowZero: true, allowNegative: true };
    expect(parseAmount(formatMinor(n), opts)).toBe(n);
    expect(parseAmount(minorToInput(n), opts)).toBe(n);
  });
});

describe('percent', () => {
  it('parses to basis points', () => {
    expect([parsePercent('50'), parsePercent('2.5'), parsePercent('12.25'), parsePercent('100')]).toEqual([5000, 250, 1225, 10000]);
  });
  it('rejects the rest', () => {
    for (const t of ['0', '-5', '101', '2.555', 'abc', '']) expect(parsePercent(t)).toBeNull();
  });
  it('writes percent text', () => {
    expect([5000, 250, 1225, 10000, 1].map(percentText)).toEqual(['50', '2.5', '12.25', '100', '0.01']);
  });
});
