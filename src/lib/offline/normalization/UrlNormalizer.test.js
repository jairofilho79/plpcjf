/**
 * UrlNormalizer Test Suite
 * Basic compatibility tests for UrlNormalizer
 * 
 * Note: This is a basic test file. For full test coverage, integrate with
 * a testing framework like Vitest, Jest, or Mocha.
 * 
 * To run manually:
 * - Import in browser console and call runTests()
 * - Or integrate with a test runner
 */

import urlNormalizer, { normalizePdfUrl as normalizePdfUrlOriginal } from './UrlNormalizer.js';
import { normalizePdfUrl } from '$lib/utils/pathUtils';

/**
 * Test cases for URL normalization
 */
const testCases = [
  // Basic paths
  { input: 'assets/ColAdultos/001.pdf', expected: 'assets/coladultos/001.pdf' },
  { input: '/assets/ColAdultos/001.pdf', expected: 'assets/coladultos/001.pdf' },
  { input: 'assets\\ColAdultos\\001.pdf', expected: 'assets/coladultos/001.pdf' },
  
  // URLs with protocol
  { input: 'https://example.com/assets/ColAdultos/001.pdf', expected: 'assets/coladultos/001.pdf' },
  { input: 'http://example.com/assets/ColAdultos/001.pdf', expected: 'assets/coladultos/001.pdf' },
  
  // URI encoded
  { input: 'assets/ColAdultos/001%20test.pdf', expected: 'assets/coladultos/001 test.pdf' },
  { input: 'assets/ColAdultos/001%2Ftest.pdf', expected: 'assets/coladultos/001/test.pdf' },
  
  // Multiple encoding
  { input: 'assets/ColAdultos/001%2520test.pdf', expected: 'assets/coladultos/001%20test.pdf' },
  
  // Missing assets prefix
  { input: 'ColAdultos/001.pdf', expected: 'assets/coladultos/001.pdf' },
  { input: '/ColAdultos/001.pdf', expected: 'assets/coladultos/001.pdf' },
  
  // Edge cases
  { input: '', expected: '' },
  { input: '/', expected: 'assets/' },
  { input: 'assets/', expected: 'assets/' },
  
  // Special characters
  { input: 'assets/ColAdultos/001-teste.pdf', expected: 'assets/coladultos/001-teste.pdf' },
  { input: 'assets/ColAdultos/001_teste.pdf', expected: 'assets/coladultos/001_teste.pdf' },
];

/**
 * Run compatibility test
 * Tests that UrlNormalizer produces same results as original function
 */
export function runCompatibilityTest() {
  console.log('Running UrlNormalizer compatibility tests...\n');
  
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const testCase of testCases) {
    const originalResult = normalizePdfUrl(testCase.input);
    const normalizerResult = urlNormalizer.normalizePdfUrl(testCase.input);
    
    if (originalResult === normalizerResult) {
      passed++;
      console.log(`✓ PASS: "${testCase.input}" -> "${normalizerResult}"`);
    } else {
      failed++;
      const error = {
        input: testCase.input,
        expected: testCase.expected || originalResult,
        original: originalResult,
        normalizer: normalizerResult
      };
      failures.push(error);
      console.error(`✗ FAIL: "${testCase.input}"`);
      console.error(`  Original:  "${originalResult}"`);
      console.error(`  Normalizer: "${normalizerResult}"`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  
  if (failures.length > 0) {
    console.error('\nFailures:', failures);
    return false;
  }
  
  return true;
}

/**
 * Test areEqual method
 */
export function testAreEqual() {
  console.log('\nTesting areEqual method...\n');
  
  const testPairs = [
    { url1: 'assets/ColAdultos/001.pdf', url2: '/assets/ColAdultos/001.pdf', shouldEqual: true },
    { url1: 'assets/ColAdultos/001.pdf', url2: 'assets/coladultos/001.pdf', shouldEqual: true },
    { url1: 'https://example.com/assets/ColAdultos/001.pdf', url2: 'assets/ColAdultos/001.pdf', shouldEqual: true },
    { url1: 'assets/ColAdultos/001.pdf', url2: 'assets/ColAdultos/002.pdf', shouldEqual: false },
    { url1: 'assets/ColAdultos/001.pdf', url2: 'assets/ColJovens/001.pdf', shouldEqual: false },
  ];

  let passed = 0;
  let failed = 0;

  for (const pair of testPairs) {
    const result = urlNormalizer.areEqual(pair.url1, pair.url2);
    if (result === pair.shouldEqual) {
      passed++;
      console.log(`✓ PASS: areEqual("${pair.url1}", "${pair.url2}") = ${result}`);
    } else {
      failed++;
      console.error(`✗ FAIL: areEqual("${pair.url1}", "${pair.url2}") = ${result}, expected ${pair.shouldEqual}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Test isValid method
 */
export function testIsValid() {
  console.log('\nTesting isValid method...\n');
  
  const testCases = [
    { input: 'assets/ColAdultos/001.pdf', shouldBeValid: true },
    { input: '', shouldBeValid: false },
    { input: null, shouldBeValid: false },
    { input: undefined, shouldBeValid: false },
    { input: 'assets/test.pdf', shouldBeValid: true },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = urlNormalizer.isValid(testCase.input);
    if (result === testCase.shouldBeValid) {
      passed++;
      console.log(`✓ PASS: isValid("${testCase.input}") = ${result}`);
    } else {
      failed++;
      console.error(`✗ FAIL: isValid("${testCase.input}") = ${result}, expected ${testCase.shouldBeValid}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Test normalizeForCache method
 */
export function testNormalizeForCache() {
  console.log('\nTesting normalizeForCache method...\n');
  
  const testCases = [
    { input: 'assets/ColAdultos/001.pdf', shouldStartWith: 'assets/' },
    { input: '/assets/ColAdultos/001.pdf', shouldStartWith: 'assets/' },
    { input: 'https://example.com/assets/ColAdultos/001.pdf', shouldStartWith: 'assets/' },
  ];

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    const result = urlNormalizer.normalizeForCache(testCase.input);
    if (result.startsWith(testCase.shouldStartWith)) {
      passed++;
      console.log(`✓ PASS: normalizeForCache("${testCase.input}") = "${result}"`);
    } else {
      failed++;
      console.error(`✗ FAIL: normalizeForCache("${testCase.input}") = "${result}", should start with "${testCase.shouldStartWith}"`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  return failed === 0;
}

/**
 * Run all tests
 */
export function runAllTests() {
  console.log('='.repeat(60));
  console.log('UrlNormalizer Test Suite');
  console.log('='.repeat(60));
  
  const results = {
    compatibility: runCompatibilityTest(),
    areEqual: testAreEqual(),
    isValid: testIsValid(),
    normalizeForCache: testNormalizeForCache()
  };

  console.log('\n' + '='.repeat(60));
  console.log('Test Summary');
  console.log('='.repeat(60));
  console.log(`Compatibility: ${results.compatibility ? 'PASS' : 'FAIL'}`);
  console.log(`areEqual: ${results.areEqual ? 'PASS' : 'FAIL'}`);
  console.log(`isValid: ${results.isValid ? 'PASS' : 'FAIL'}`);
  console.log(`normalizeForCache: ${results.normalizeForCache ? 'PASS' : 'FAIL'}`);
  
  const allPassed = Object.values(results).every(r => r === true);
  console.log(`\nOverall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('='.repeat(60));

  return allPassed;
}

// Export for manual execution
if (typeof window !== 'undefined') {
  window.urlNormalizerTests = {
    runAllTests,
    runCompatibilityTest,
    testAreEqual,
    testIsValid,
    testNormalizeForCache
  };
}

export default {
  runAllTests,
  runCompatibilityTest,
  testAreEqual,
  testIsValid,
  testNormalizeForCache
};

