/**
 * Unit tests for the pure duplicate-member logic (no DB needed).
 * Rule under test: a member is a duplicate when at least 2 of the 3
 * identifying fields (name / birthday / phone) match an existing member.
 */
const {
  normalizeName,
  normalizePhone,
  toISODate,
  matchedCriteria,
  countMatches,
} = require('../../src/utils/duplicates');

describe('normalizeName', () => {
  test('lowercases, trims and collapses inner whitespace', () => {
    expect(normalizeName('  AMA   Mensah ')).toBe('ama mensah');
    expect(normalizeName('ama\tmensah')).toBe('ama mensah');
  });
  test('blank values become null', () => {
    expect(normalizeName('')).toBeNull();
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName(null)).toBeNull();
    expect(normalizeName(undefined)).toBeNull();
  });
});

describe('normalizePhone', () => {
  test('strips formatting and compares the last 9 digits', () => {
    expect(normalizePhone('+233 244 123 456')).toBe('244123456');
    expect(normalizePhone('0244 123 456')).toBe('244123456');
    expect(normalizePhone('0244-123-456')).toBe('244123456');
    expect(normalizePhone('(0244) 123456')).toBe('244123456');
  });
  test('keeps 7-9 digit numbers as-is', () => {
    expect(normalizePhone('1234567')).toBe('1234567');
    expect(normalizePhone('12345678')).toBe('12345678');
    expect(normalizePhone('123456789')).toBe('123456789');
  });
  test('short or blank input is treated as no phone', () => {
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('123456')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe('toISODate', () => {
  test('passes strings through (first 10 chars)', () => {
    expect(toISODate('1990-05-01')).toBe('1990-05-01');
  });
  test('formats Date objects in local time', () => {
    expect(toISODate(new Date(1990, 4, 1))).toBe('1990-05-01');
  });
  test('null stays null', () => {
    expect(toISODate(null)).toBeNull();
  });
});

describe('matchedCriteria / countMatches (the 2-of-3 rule)', () => {
  const existing = { full_name: 'Ama Mensah', phone: '+233 244 123 456', birthday: '1990-05-01' };

  test('all three match -> 3', () => {
    expect(countMatches({ fullName: 'ama mensah', phone: '0244123456', birthday: '1990-05-01' }, existing)).toBe(3);
    expect(matchedCriteria({ fullName: 'ama mensah', phone: '0244123456', birthday: '1990-05-01' }, existing))
      .toEqual(['name', 'phone', 'birthday']);
  });
  test('exactly two match -> 2 (duplicate)', () => {
    expect(countMatches({ fullName: 'Ama Mensah', phone: '0244123456' }, existing)).toBe(2);
    expect(countMatches({ fullName: 'Ama Mensah', birthday: '1990-05-01' }, existing)).toBe(2);
    expect(countMatches({ fullName: 'Other Name', phone: '0244123456', birthday: '1990-05-01' }, existing)).toBe(2);
  });
  test('exactly one match -> 1 (allowed, not a duplicate)', () => {
    expect(countMatches({ fullName: 'Ama Mensah' }, existing)).toBe(1);
    expect(countMatches({ fullName: 'Other', phone: '0244123456' }, existing)).toBe(1);
    expect(countMatches({ fullName: 'Other', birthday: '1990-05-01' }, existing)).toBe(1);
  });
  test('no match -> 0', () => {
    expect(countMatches({ fullName: 'Zed', phone: '099', birthday: '2000-01-01' }, existing)).toBe(0);
  });
  test('missing fields on either side never count as matches', () => {
    expect(countMatches({ fullName: 'Ama Mensah', phone: '', birthday: null }, { full_name: 'Ama Mensah', phone: null, birthday: null })).toBe(1);
    expect(countMatches({ fullName: '', phone: '', birthday: '' }, existing)).toBe(0);
  });
});
