/**
 * Master Test Runner - Runs all module tests sequentially
 * Tests the complete Teacher Salary Management System
 */

const { spawn } = require('child_process');
const path = require('path');

// Define all test files in order
const testFiles = [
  'testModule7Analytics.js',
  'testModule8SettingsManagement.js',
  'testModule9Currency.js',
  'testModule10Advanced.js'
];

// Track results
const results = {
  modules: [],
  totalTests: 0,
  totalPassed: 0,
  totalFailed: 0
};

console.log('');
console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║   TEACHER SALARY MANAGEMENT SYSTEM - COMPREHENSIVE TEST SUITE      ║');
console.log('╚════════════════════════════════════════════════════════════════════╝');
console.log('');

// Run tests sequentially
async function runTest(testFile) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`Running: ${testFile}`);
    console.log('='.repeat(70));
    
    const testPath = path.join(__dirname, testFile);
    const child = spawn('node', [testPath], {
      stdio: 'inherit',
      shell: true
    });
    
    child.on('close', (code) => {
      const passed = code === 0;
      results.modules.push({
        name: testFile,
        passed
      });
      resolve(passed);
    });
  });
}

// Run all tests
async function runAllTests() {
  const startTime = Date.now();
  
  for (const testFile of testFiles) {
    const passed = await runTest(testFile);
    if (!passed) {
      console.log(`\n⚠️  ${testFile} had failures - continuing with remaining tests...\n`);
    }
  }
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  // Print summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         FINAL TEST SUMMARY                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('');
  
  results.modules.forEach((module, index) => {
    const status = module.passed ? '✅ PASSED' : '❌ FAILED';
    const moduleName = module.name.replace('.js', '');
    console.log(`${(index + 1).toString().padStart(2)}. ${moduleName.padEnd(35)} ${status}`);
  });
  
  const passedCount = results.modules.filter(m => m.passed).length;
  const totalCount = results.modules.length;
  const passRate = ((passedCount / totalCount) * 100).toFixed(2);
  
  console.log('');
  console.log('─'.repeat(70));
  console.log(`Total Modules: ${totalCount}`);
  console.log(`Modules Passed: ${passedCount} ✅`);
  console.log(`Modules Failed: ${totalCount - passedCount} ${totalCount - passedCount > 0 ? '❌' : ''}`);
  console.log(`Success Rate: ${passRate}%`);
  console.log(`Duration: ${duration}s`);
  console.log('─'.repeat(70));
  console.log('');
  
  if (passedCount === totalCount) {
    console.log('🎉 ALL TESTS PASSED! System is production-ready! 🎉');
    console.log('');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed. Please review the output above.');
    console.log('');
    process.exit(1);
  }
}

// Start test execution
runAllTests().catch(error => {
  console.error('Error running tests:', error);
  process.exit(1);
});
