/**
 * COMPREHENSIVE TEST: Hour Adjustments on Status Changes
 * 
 * Tests:
 * 1. Non-countable → Countable (cancelled → attended): Teacher +1h, Guardian -1h
 * 2. Countable → Non-countable (attended → cancelled): Teacher -1h, Guardian +1h
 * 3. Re-submission protection (should NOT adjust hours twice)
 * 4. Cancelled classes removed from invoices
 */

const mongoose = require('mongoose');
const Class = require('./models/Class');
const User = require('./models/User');
const Invoice = require('./models/Invoice');

async function runTests() {
  try {
    console.log('🧪 Starting Hour Adjustment Tests\n');
    await mongoose.connect('mongodb://localhost:27017/waraqa-new');
    console.log('✅ Connected to MongoDB\n');

    // Find a test class with teacher and guardian
    const testClass = await Class.findOne({
      teacher: { $exists: true },
      'student.guardianId': { $exists: true },
      'student.studentId': { $exists: true }
    }).sort({ scheduledDate: -1 }).limit(1);

    if (!testClass) {
      console.log('❌ No suitable test class found');
      process.exit(1);
    }

    console.log('📝 Test Class Found:');
    console.log(`   ID: ${testClass._id}`);
    console.log(`   Current Status: ${testClass.status}`);
    console.log(`   Teacher: ${testClass.teacher}`);
    console.log(`   Guardian: ${testClass.student.guardianId}`);
    console.log(`   Duration: ${testClass.duration} minutes\n`);

    // Get initial hours
    const teacher = await User.findById(testClass.teacher);
    const guardian = await User.findById(testClass.student.guardianId);
    
    if (!teacher || !guardian) {
      console.log('❌ Teacher or Guardian not found');
      process.exit(1);
    }

    const student = guardian.guardianInfo?.students?.find(
      s => String(s._id) === String(testClass.student.studentId)
    );

    if (!student) {
      console.log('❌ Student not found in guardian record');
      process.exit(1);
    }

    console.log('📊 INITIAL STATE:');
    console.log(`   👨‍🏫 Teacher (${teacher.firstName} ${teacher.lastName}):`);
    console.log(`      Monthly Hours: ${teacher.teacherInfo?.monthlyHours || 0}h`);
    console.log(`   👨‍👩‍👧 Guardian (${guardian.firstName} ${guardian.lastName}):`);
    console.log(`      Student Hours: ${student.hoursRemaining || 0}h`);
    console.log(`      Total Hours: ${guardian.guardianInfo?.totalHours || 0}h\n`);

    const initialTeacherHours = Number(teacher.teacherInfo?.monthlyHours || 0);
    const initialGuardianStudentHours = Number(student.hoursRemaining || 0);
    const initialGuardianTotalHours = Number(guardian.guardianInfo?.totalHours || 0);
    const classDuration = Number(testClass.duration || 60);
    const classHours = classDuration / 60;

    // TEST 1: Non-countable → Countable (cancelled → attended)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 TEST 1: Non-countable → Countable (cancelled → attended)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // First set to cancelled (non-countable)
    testClass.status = 'cancelled_by_teacher';
    testClass.classReport = {
      attendance: 'cancelled_by_teacher',
      submittedAt: new Date(),
      submittedBy: teacher._id
    };
    await testClass.save();
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get teacher/guardian after cancelled
    const teacherAfterCancel = await User.findById(testClass.teacher);
    const guardianAfterCancel = await User.findById(testClass.student.guardianId);
    const studentAfterCancel = guardianAfterCancel.guardianInfo?.students?.find(
      s => String(s._id) === String(testClass.student.studentId)
    );

    console.log('✅ Class set to CANCELLED');
    console.log(`   👨‍🏫 Teacher Hours: ${teacherAfterCancel.teacherInfo?.monthlyHours || 0}h (expected: ${initialTeacherHours}h)`);
    console.log(`   👨‍👩‍👧 Guardian Student Hours: ${studentAfterCancel.hoursRemaining || 0}h (expected: ${initialGuardianStudentHours}h)`);
    console.log(`   👨‍👩‍👧 Guardian Total Hours: ${guardianAfterCancel.guardianInfo?.totalHours || 0}h (expected: ${initialGuardianTotalHours}h)\n`);

    // Now change to attended (countable)
    console.log('🔄 Changing status to ATTENDED (first submission)...\n');
    testClass.status = 'attended';
    testClass.classReport = {
      attendance: 'both_present',
      submittedAt: new Date(),
      submittedBy: teacher._id,
      lastEditedAt: new Date(),
      lastEditedBy: teacher._id
    };
    await testClass.save();

    // Wait for hooks to execute
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get final hours
    const teacherAfterAttended = await User.findById(testClass.teacher);
    const guardianAfterAttended = await User.findById(testClass.student.guardianId);
    const studentAfterAttended = guardianAfterAttended.guardianInfo?.students?.find(
      s => String(s._id) === String(testClass.student.studentId)
    );

    const teacherHoursAfterAttended = Number(teacherAfterAttended.teacherInfo?.monthlyHours || 0);
    const guardianStudentHoursAfterAttended = Number(studentAfterAttended.hoursRemaining || 0);
    const guardianTotalHoursAfterAttended = Number(guardianAfterAttended.guardianInfo?.totalHours || 0);

    console.log('✅ Class changed to ATTENDED\n');
    console.log('📊 RESULTS:');
    console.log(`   👨‍🏫 Teacher Hours:`);
    console.log(`      Before (cancelled): ${teacherAfterCancel.teacherInfo?.monthlyHours || 0}h`);
    console.log(`      After (attended): ${teacherHoursAfterAttended}h`);
    console.log(`      Expected Change: +${classHours}h`);
    console.log(`      Actual Change: ${(teacherHoursAfterAttended - (teacherAfterCancel.teacherInfo?.monthlyHours || 0)).toFixed(2)}h`);
    
    const teacherTest1Pass = Math.abs(teacherHoursAfterAttended - (teacherAfterCancel.teacherInfo?.monthlyHours || 0) - classHours) < 0.01;
    console.log(`      ${teacherTest1Pass ? '✅ PASS' : '❌ FAIL'}\n`);

    console.log(`   👨‍👩‍👧 Guardian Student Hours:`);
    console.log(`      Before (cancelled): ${studentAfterCancel.hoursRemaining || 0}h`);
    console.log(`      After (attended): ${guardianStudentHoursAfterAttended}h`);
    console.log(`      Expected Change: -${classHours}h`);
    console.log(`      Actual Change: ${(guardianStudentHoursAfterAttended - (studentAfterCancel.hoursRemaining || 0)).toFixed(2)}h`);
    
    const guardianTest1Pass = Math.abs(guardianStudentHoursAfterAttended - (studentAfterCancel.hoursRemaining || 0) + classHours) < 0.01;
    console.log(`      ${guardianTest1Pass ? '✅ PASS' : '❌ FAIL'}\n`);

    // TEST 2: Re-submission protection
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 TEST 2: Re-submission Protection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const hoursBeforeResubmit = {
      teacher: teacherHoursAfterAttended,
      guardianStudent: guardianStudentHoursAfterAttended,
      guardianTotal: guardianTotalHoursAfterAttended
    };

    console.log('🔄 Re-submitting report (changing attended → cancelled)...\n');
    testClass.status = 'cancelled_by_teacher';
    testClass.classReport.lastEditedAt = new Date();
    testClass.classReport.lastEditedBy = teacher._id;
    await testClass.save();

    await new Promise(resolve => setTimeout(resolve, 500));

    const teacherAfterResubmit = await User.findById(testClass.teacher);
    const guardianAfterResubmit = await User.findById(testClass.student.guardianId);
    const studentAfterResubmit = guardianAfterResubmit.guardianInfo?.students?.find(
      s => String(s._id) === String(testClass.student.studentId)
    );

    console.log('📊 RESULTS (should show hour changes since this is FIRST cancellation):');
    console.log(`   👨‍🏫 Teacher Hours:`);
    console.log(`      Before: ${hoursBeforeResubmit.teacher}h`);
    console.log(`      After: ${teacherAfterResubmit.teacherInfo?.monthlyHours || 0}h`);
    console.log(`      Expected: Hours SHOULD decrease by ${classHours}h (reverting the attended hours)`);
    console.log(`      Actual Change: ${((teacherAfterResubmit.teacherInfo?.monthlyHours || 0) - hoursBeforeResubmit.teacher).toFixed(2)}h`);
    
    const expectedTeacherAfterCancel = hoursBeforeResubmit.teacher - classHours;
    const teacherTest2Pass = Math.abs((teacherAfterResubmit.teacherInfo?.monthlyHours || 0) - expectedTeacherAfterCancel) < 0.01;
    console.log(`      ${teacherTest2Pass ? '✅ PASS - Hours correctly adjusted' : '❌ FAIL'}\n`);

    console.log(`   👨‍👩‍👧 Guardian Student Hours:`);
    console.log(`      Before: ${hoursBeforeResubmit.guardianStudent}h`);
    console.log(`      After: ${studentAfterResubmit.hoursRemaining || 0}h`);
    console.log(`      Expected: Hours SHOULD increase by ${classHours}h (reverting the attended deduction)`);
    console.log(`      Actual Change: ${((studentAfterResubmit.hoursRemaining || 0) - hoursBeforeResubmit.guardianStudent).toFixed(2)}h`);
    
    const expectedGuardianAfterCancel = hoursBeforeResubmit.guardianStudent + classHours;
    const guardianTest2Pass = Math.abs((studentAfterResubmit.hoursRemaining || 0) - expectedGuardianAfterCancel) < 0.01;
    console.log(`      ${guardianTest2Pass ? '✅ PASS - Hours correctly adjusted' : '❌ FAIL'}\n`);

    // TEST 3: Check if cancelled classes appear in invoices
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🧪 TEST 3: Cancelled Classes in Invoices');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Find all invoices containing cancelled classes
    const invoicesWithCancelled = await Invoice.find({
      'items.class': { $exists: true },
      deleted: { $ne: true }
    }).lean();

    let cancelledClassesInInvoices = 0;
    const problemInvoices = [];

    for (const invoice of invoicesWithCancelled) {
      for (const item of invoice.items) {
        if (item.class) {
          const classDoc = await Class.findById(item.class).select('status').lean();
          if (classDoc && String(classDoc.status).includes('cancelled')) {
            cancelledClassesInInvoices++;
            problemInvoices.push({
              invoice: invoice.invoiceNumber || invoice._id,
              status: invoice.status,
              classId: item.class,
              classStatus: classDoc.status
            });
          }
        }
      }
    }

    console.log('📊 RESULTS:');
    console.log(`   Total Invoices Checked: ${invoicesWithCancelled.length}`);
    console.log(`   Cancelled Classes Found: ${cancelledClassesInInvoices}`);
    
    if (cancelledClassesInInvoices === 0) {
      console.log(`   ✅ PASS - No cancelled classes in invoices\n`);
    } else {
      console.log(`   ❌ FAIL - Found cancelled classes in invoices:\n`);
      problemInvoices.forEach(p => {
        console.log(`      Invoice: ${p.invoice} (${p.status})`);
        console.log(`      Class: ${p.classId} (status: ${p.classStatus})\n`);
      });
    }

    // FINAL SUMMARY
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📋 FINAL SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const allPassed = teacherTest1Pass && guardianTest1Pass && teacherTest2Pass && guardianTest2Pass && cancelledClassesInInvoices === 0;

    console.log(`Test 1 - Non-countable → Countable:`);
    console.log(`   Teacher Hours: ${teacherTest1Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Guardian Hours: ${guardianTest1Pass ? '✅ PASS' : '❌ FAIL'}`);
    
    console.log(`\nTest 2 - Hour Adjustment on Status Change:`);
    console.log(`   Teacher Hours: ${teacherTest2Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Guardian Hours: ${guardianTest2Pass ? '✅ PASS' : '❌ FAIL'}`);
    
    console.log(`\nTest 3 - Cancelled Classes in Invoices:`);
    console.log(`   ${cancelledClassesInInvoices === 0 ? '✅ PASS' : '❌ FAIL'}`);
    
    console.log(`\n${allPassed ? '🎉 ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED'}\n`);

    process.exit(allPassed ? 0 : 1);

  } catch (err) {
    console.error('💥 Test Error:', err);
    process.exit(1);
  }
}

runTests();
