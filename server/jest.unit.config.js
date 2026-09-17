/**
 * Offline suite: the pure-JS units that need no Postgres, no globalSetup and no
 * test database. `npm test` still runs everything (tests/unit included).
 *
 *   npx jest --config jest.unit.config.js
 */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/unit'],
  testTimeout: 20000,
  clearMocks: true,
};
