import { errorResult, formatMcpResult } from './src/core/write/mutation-helpers.js';
console.log(JSON.stringify(formatMcpResult(errorResult('test', 'test error')), null, 2));
