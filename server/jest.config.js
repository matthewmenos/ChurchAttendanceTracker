module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  globalSetup: '<rootDir>/tests/global-setup.js',
  testTimeout: 20000,
  clearMocks: true,
};