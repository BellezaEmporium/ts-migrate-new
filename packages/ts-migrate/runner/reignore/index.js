/* eslint-disable  @typescript-eslint/no-require-imports,no-undef */
const { createJestRunner } = require('create-jest-runner');

module.exports = createJestRunner(require.resolve('./run'));
