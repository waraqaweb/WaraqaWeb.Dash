const mongoose = require('mongoose');
const User = require('../models/User');
const Class = require('../models/Class');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Find all guardians
    const guardians = await User.find({ role: 'guardian' }).select('_id firstName lastName email guardianInfo.students');
    console.log('\n📋 All guardians:');
    guardians.forEach(g => {
      console.log(`  - ${g.firstName} ${g.lastName} (${g.email}) | ID: ${g._id.toString()}`);
      console.log(`    Students: ${g.guardianInfo?.students?.length || 0}`);
    });
    
    // Find Mariam by the ID we saw in logs
    const mariamId = '690c3c55c832ddfa9898c416';
    const mariam = await User.findById(mariamId);
    if (!mariam) {
      console.log(`\n❌ Guardian ${mariamId} not found!`);
      process.exit(1);
    }
    
    console.log('\n📋 Guardian from logs:');
    console.log('  _id:', mariam._id.toString());
    console.log('  Name:', mariam.firstName, mariam.lastName);
    console.log('  Students:', mariam.guardianInfo?.students?.map(s => s._id.toString()));
    
    // Find her classes
    const classes = await Class.find({ 
      'student.studentName': /Malak/ 
    }).select('_id scheduledDate student status billedInInvoiceId');
    
    console.log('\n📚 Classes for Malak:');
    classes.forEach(c => {
      console.log(`  - ${c._id.toString().slice(-6)} | ${c.scheduledDate?.toISOString()?.slice(0,10)} | status: ${c.status}`);
      console.log(`    guardianId: ${c.student?.guardianId?.toString()}`);
      console.log(`    studentId: ${c.student?.studentId?.toString()}`);
      console.log(`    billed: ${c.billedInInvoiceId ? 'YES' : 'NO'}`);
    });
    
    // Check if IDs match
    const classGuardianIds = classes.map(c => c.student?.guardianId?.toString()).filter(Boolean);
    const matches = classGuardianIds.filter(id => id === mariam._id.toString()).length;
    
    console.log(`\n✅ Matching guardianIds: ${matches}/${classes.length}`);
    
    if (matches !== classes.length) {
      console.log('⚠️  Some classes have mismatched guardianId!');
    }
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Error:', err);
    process.exit(1);
  });
