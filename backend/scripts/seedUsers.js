/**
 * Comprehensive Seed Script
 *
 * - Resets core collections and inserts a clean demo dataset
 * - Creates admin, teachers, guardians, students (embedded + standalone)
 * - Seeds two recurring class series with upcoming occurrences
 *
 * Safe to re-run: existing users/classes/availability/etc. are wiped first.
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');

const User = require('../models/User');
const Student = require('../models/Student');
const Class = require('../models/Class');
const AvailabilitySlot = require('../models/AvailabilitySlot');
const Vacation = require('../models/Vacation');
const Notification = require('../models/Notification');
const ClassReport = require('../models/ClassReport');
const SystemVacation = require('../models/SystemVacation');
const UnavailablePeriod = require('../models/UnavailablePeriod');

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/online-class-manager';
const DEFAULT_TIMEZONE = 'Africa/Cairo';

const toTimeString = (hour, minute) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const getUpcomingDate = (weekday, hour, minute) => {
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);
  let diff = (weekday - candidate.getDay() + 7) % 7;
  if (diff === 0 && candidate <= now) diff = 7;
  candidate.setDate(candidate.getDate() + diff);
  return candidate;
};

const addWeeks = (date, weeks) => new Date(date.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);

async function resetCollections() {
  const collections = [
    User,
    Student,
    Class,
    AvailabilitySlot,
    Vacation,
    Notification,
    ClassReport,
    SystemVacation,
    UnavailablePeriod
  ];

  for (const model of collections) {
    const { modelName } = model;
    await model.deleteMany({});
    console.log(`🧹 Cleared ${modelName} collection`);
  }
}

async function createAdmin() {
  const admin = await User.create({
    firstName: 'System',
    lastName: 'Administrator',
  email: process.env.ADMIN_EMAIL || 'admin@waraqa.co',
    password: process.env.ADMIN_PASSWORD || 'Admin@123',
    role: 'admin',
    isActive: true,
    isEmailVerified: true,
    timezone: DEFAULT_TIMEZONE,
    phone: '+201000000001',
    address: {
      street: '12 Nile Street',
      city: 'Cairo',
      state: 'Cairo',
      country: 'Egypt',
      zipCode: '11511'
    },
    notifications: {
      email: true,
      sms: false,
      push: true
    }
  });

  console.log(`✅ Admin ready: ${admin.email}`);
  return admin;
}

async function createTeachers() {
  const teacherSeeds = [
    {
      firstName: 'Ahmed',
      lastName: 'Ismail',
      email: 'ahmed.ismail@waraqa.co',
      password: 'Teacher@123',
      gender: 'male',
      dateOfBirth: new Date('1990-05-14'),
      phone: '+201234567801',
      address: {
        street: '24 Learning Ave',
        city: 'Giza',
        state: 'Giza',
        country: 'Egypt',
        zipCode: '12511'
      },
      timezone: DEFAULT_TIMEZONE,
      role: 'teacher',
      isActive: true,
      isEmailVerified: true,
      profilePicture: null,
      teacherInfo: {
        subjects: ['Quran', 'Arabic Language'],
        qualifications: [
          { degree: 'BA Islamic Studies', institution: 'Al Azhar University', year: 2018 },
          { degree: 'Ijazah in Tajweed', institution: 'Dar Al Quran', year: 2020 }
        ],
        hourlyRate: 12,
        monthlyHours: 0,
        monthlyEarnings: 0,
        bonus: 0,
        instapayName: 'Ahmed Ismail',
        bankDetails: {
          accountNumber: '001122334455',
          bankName: 'National Bank of Egypt',
          iban: 'EG1100011223344556677889900',
          swift: 'NBEGEGCX',
          pendingApproval: false,
          lastUpdated: new Date()
        },
        spokenLanguages: ['Arabic', 'English'],
        bio: 'Certified Quran tutor with 5+ years of online experience helping students master Tajweed.',
        googleMeetLink: 'https://meet.google.com/ahmed-hassan',
        availabilityConfig: {
          minHoursPerDay: 2,
          minDaysPerWeek: 3,
          isAvailabilityRequired: true,
          lastUpdated: new Date()
        },
        availabilityStatus: 'custom_set',
        preferredStudentAgeRange: { min: 7, max: 16 },
        preferredFemaleAgeRange: { min: 7, max: 18 },
        preferredMaleAgeRange: { min: 7, max: 16 },
        totalClassesTaught: 0,
        monthlyHours: 0,
        monthlyEarnings: 0,
        lastMonthlyReset: new Date()
      }
    },
    {
      firstName: 'Lamiaa',
      lastName: 'Ali',
      email: 'lamiaa.ali@waraqa.co',
      password: 'Teacher@123',
      gender: 'female',
      dateOfBirth: new Date('1992-11-22'),
      phone: '+201234567802',
      address: {
        street: '8 Knowledge Road',
        city: 'Alexandria',
        state: 'Alexandria',
        country: 'Egypt',
        zipCode: '21532'
      },
      timezone: DEFAULT_TIMEZONE,
      role: 'teacher',
      isActive: true,
      isEmailVerified: true,
      profilePicture: null,
      teacherInfo: {
        subjects: ['Arabic Conversation', 'Islamic Studies'],
        qualifications: [
          { degree: 'MA Arabic Language', institution: 'Alexandria University', year: 2017 },
          { degree: 'Teaching Diploma', institution: 'AUC', year: 2019 }
        ],
        hourlyRate: 14,
        monthlyHours: 0,
        monthlyEarnings: 0,
        bonus: 0,
        instapayName: 'Lamiaa Ali',
        bankDetails: {
          accountNumber: '556677889900',
          bankName: 'Banque Misr',
          iban: 'EG22005566778899001234567890',
          swift: 'BMISEGCX',
          pendingApproval: false,
          lastUpdated: new Date()
        },
        spokenLanguages: ['Arabic', 'English', 'French'],
        bio: 'Native Arabic tutor focused on conversational fluency and cultural immersion for young learners.',
        googleMeetLink: 'https://meet.google.com/sara-ibrahim',
        availabilityConfig: {
          minHoursPerDay: 1,
          minDaysPerWeek: 4,
          isAvailabilityRequired: true,
          lastUpdated: new Date()
        },
        availabilityStatus: 'custom_set',
        preferredStudentAgeRange: { min: 6, max: 18 },
        preferredFemaleAgeRange: { min: 6, max: 25 },
        preferredMaleAgeRange: { min: 6, max: 18 },
        totalClassesTaught: 0,
        monthlyHours: 0,
        monthlyEarnings: 0,
        lastMonthlyReset: new Date()
      }
    }
  ];

  const teachers = [];
  for (const seed of teacherSeeds) {
    const teacher = await User.create(seed);
    teachers.push(teacher);
    console.log(`✅ Teacher ready: ${teacher.email}`);
  }

  return teachers;
}

async function createGuardians(teachers) {
  const [teacherAhmed, teacherSara] = teachers;

  const guardianSeeds = [
    {
      firstName: 'Mariam',
      lastName: 'El-Sayed',
  email: 'mariam.elsayed@waraqa.co',
      password: 'Guardian@123',
      gender: 'female',
      phone: '+201234567811',
      address: {
        street: '18 Family Street',
        city: 'Cairo',
        state: 'Cairo',
        country: 'Egypt',
        zipCode: '11835'
      },
      timezone: DEFAULT_TIMEZONE,
      role: 'guardian',
      isActive: true,
      isEmailVerified: true,
      guardianInfo: {
        relationship: 'mother',
        emergencyContact: {
          name: 'Hassan El-Sayed',
          phone: '+201234567810',
          relationship: 'father'
        },
        paymentMethod: 'bank_transfer',
        hourlyRate: 12,
        billingAddress: {
          street: '18 Family Street',
          city: 'Cairo',
          state: 'Cairo',
          country: 'Egypt'
        },
        bankDetails: {
          accountNumber: '778899001122',
          bankName: 'Commercial International Bank',
          iban: 'EG33007788990011223344556677',
          swift: 'CIBEEGCX',
          pendingApproval: false,
          lastUpdated: new Date()
        },
        spokenLanguages: ['Arabic', 'English'],
        students: [
          {
            firstName: 'Ali',
            lastName: 'Hassan',
            email: 'ali.hassan@student.co',
            grade: 'Grade 5',
            school: 'Cairo International School',
            language: 'English',
            subjects: ['Quran', 'Arabic'],
            phone: '+201050001111',
            whatsapp: '+201050001111',
            learningPreferences: 'Visual learner, enjoys interactive sessions.',
            evaluation: 'Initial assessment completed successfully.',
            evaluationSummary: 'Strong recitation skills; needs support with memorization.',
            dateOfBirth: new Date('2014-03-15'),
            gender: 'male',
            timezone: DEFAULT_TIMEZONE,
            hoursRemaining: 0,
            totalClassesAttended: 0,
            currentTeachers: [teacherAhmed._id],
            notes: 'Excited about weekly Quran classes.'
          },
          {
            firstName: 'Huda',
            lastName: 'Hassan',
            email: 'huda.hassan@student.co',
            grade: 'Grade 3',
            school: 'Cairo Modern School',
            language: 'English',
            subjects: ['Arabic Conversation'],
            phone: '+201050002222',
            whatsapp: '+201050002222',
            learningPreferences: 'Enjoys storytelling and songs.',
            evaluation: 'Awaiting first class.',
            evaluationSummary: 'Needs confidence in speaking Arabic.',
            dateOfBirth: new Date('2016-09-02'),
            gender: 'female',
            timezone: DEFAULT_TIMEZONE,
            hoursRemaining: 0,
            totalClassesAttended: 0,
            currentTeachers: [teacherSara._id],
            notes: 'Prefers afternoon sessions.'
          }
        ]
      }
    },
    {
      firstName: 'Khaled',
      lastName: 'Mostafa',
  email: 'khaled.mostafa@waraqa.co',
      password: 'Guardian@123',
      gender: 'male',
      phone: '+201234567812',
      address: {
        street: '4 Crescent Lane',
        city: 'Cairo',
        state: 'Cairo',
        country: 'Egypt',
        zipCode: '11835'
      },
      timezone: DEFAULT_TIMEZONE,
      role: 'guardian',
      isActive: true,
      isEmailVerified: true,
      guardianInfo: {
        relationship: 'father',
        emergencyContact: {
          name: 'Samira Mostafa',
          phone: '+201234567813',
          relationship: 'mother'
        },
        paymentMethod: 'credit_card',
        hourlyRate: 14,
        billingAddress: {
          street: '4 Crescent Lane',
          city: 'Cairo',
          state: 'Cairo',
          country: 'Egypt'
        },
        bankDetails: {
          accountNumber: '990011223344',
          bankName: 'HSBC Egypt',
          iban: 'EG44009900112233445566778899',
          swift: 'EBBKEGCX',
          pendingApproval: false,
          lastUpdated: new Date()
        },
        spokenLanguages: ['Arabic', 'English'],
        students: [
          {
            firstName: 'Malak',
            lastName: 'Mostafa',
            email: 'malak.mostafa@student.co',
            grade: 'Grade 7',
            school: 'Future Pioneers School',
            language: 'English',
            subjects: ['Arabic Conversation', 'Islamic Studies'],
            phone: '+201060003333',
            whatsapp: '+201060003333',
            learningPreferences: 'Enjoys discussions and role-play.',
            evaluation: 'Shows great enthusiasm for conversation practice.',
            evaluationSummary: 'Focus on vocabulary expansion.',
            dateOfBirth: new Date('2012-01-23'),
            gender: 'female',
            timezone: DEFAULT_TIMEZONE,
            hoursRemaining: 0,
            totalClassesAttended: 0,
            currentTeachers: [teacherSara._id],
            notes: 'Prefers early evening sessions.'
          },
          {
            firstName: 'Omar',
            lastName: 'Mostafa',
            email: 'omar.mostafa@student.co',
            grade: 'Grade 4',
            school: 'Future Pioneers School',
            language: 'English',
            subjects: ['Quran'],
            phone: '+201060004444',
            whatsapp: '+201060004444',
            learningPreferences: 'Enjoys memorization games.',
            evaluation: 'Assessment scheduled.',
            evaluationSummary: 'Builds confidence with recitation.',
            dateOfBirth: new Date('2015-07-19'),
            gender: 'male',
            timezone: DEFAULT_TIMEZONE,
            hoursRemaining: 0,
            totalClassesAttended: 0,
            currentTeachers: [teacherAhmed._id],
            notes: 'Prefers morning sessions.'
          }
        ]
      }
    }
  ];

  const guardians = [];
  for (const seed of guardianSeeds) {
    const guardian = await User.create(seed);
    guardians.push(guardian);
    console.log(`✅ Guardian ready: ${guardian.email}`);
  }

  return guardians;
}

async function createStandaloneStudents(guardians) {
  const standaloneStudents = [];

  for (const guardian of guardians) {
    const students = guardian.guardianInfo?.students || [];

    for (const studentSubdoc of students) {
      const student = await Student.create({
        _id: studentSubdoc._id,
        guardian: guardian._id,
        firstName: studentSubdoc.firstName,
        lastName: studentSubdoc.lastName,
        email: studentSubdoc.email,
        grade: studentSubdoc.grade,
        school: studentSubdoc.school,
        language: studentSubdoc.language,
        subjects: studentSubdoc.subjects,
        phone: studentSubdoc.phone,
        whatsapp: studentSubdoc.whatsapp,
        learningPreferences: studentSubdoc.learningPreferences,
        evaluation: studentSubdoc.evaluation,
        evaluationSummary: studentSubdoc.evaluationSummary,
        dateOfBirth: studentSubdoc.dateOfBirth,
        gender: studentSubdoc.gender,
        timezone: studentSubdoc.timezone,
        hoursRemaining: studentSubdoc.hoursRemaining,
        currentTeachers: studentSubdoc.currentTeachers,
        notes: studentSubdoc.notes,
        isActive: true
      });

      standaloneStudents.push(student);
      console.log(`👩‍🎓 Student ready: ${student.firstName} ${student.lastName}`);
    }
  }

  return standaloneStudents;
}

async function updateTeacherRosters(teachers, students) {
  const rosterByTeacher = new Map();

  for (const student of students) {
    const teacherIds = student.currentTeachers || [];
    for (const teacherId of teacherIds) {
      const key = teacherId.toString();
      if (!rosterByTeacher.has(key)) {
        rosterByTeacher.set(key, []);
      }
      rosterByTeacher.get(key).push({
        firstName: student.firstName,
        lastName: student.lastName,
        dateOfBirth: student.dateOfBirth,
        gender: student.gender === 'female' ? 'female' : 'male',
        guardianId: student.guardian,
        studentId: student._id.toString()
      });
    }
  }

  for (const teacher of teachers) {
    const roster = rosterByTeacher.get(teacher._id.toString()) || [];
    await User.findByIdAndUpdate(teacher._id, {
      $set: {
        'teacherInfo.studentsTaught': roster,
        'teacherInfo.totalClassesTaught': 0,
        'teacherInfo.monthlyHours': 0,
        'teacherInfo.monthlyEarnings': 0,
        'teacherInfo.bonus': 0
      }
    });
  }
}

async function seedClassSeries(admin, teachers, guardians) {
  const [teacherAhmed, teacherSara] = teachers;
  const [guardianMariam, guardianKhaled] = guardians;

  const guardianMariamStudents = guardianMariam.guardianInfo.students;
  const guardianKhaledStudents = guardianKhaled.guardianInfo.students;

  const configs = [
    {
      title: 'Quran Mastery Program',
      description: 'Weekly memorization and Tajweed practice sessions.',
      subject: 'Quran',
      teacher: teacherAhmed,
      guardian: guardianMariam,
      student: guardianMariamStudents[0],
      weekday: 1, // Monday
      hour: 17,
      minute: 0,
      duration: 60,
      timezone: DEFAULT_TIMEZONE,
      meetingLink: 'https://meet.google.com/quran-mastery',
      materials: [
        { name: 'Surah Memorization Tracker', url: 'https://files.waraqa.test/quran-tracker.pdf', type: 'document' },
        { name: 'Tajweed Rules Sheet', url: 'https://files.waraqa.test/tajweed-rules.pdf', type: 'document' }
      ]
    },
    {
      title: 'Arabic Conversation Labs',
      description: 'Interactive speaking labs focusing on real-life scenarios.',
      subject: 'Arabic Conversation',
      teacher: teacherSara,
      guardian: guardianKhaled,
      student: guardianKhaledStudents[0],
      weekday: 3, // Wednesday
      hour: 15,
      minute: 30,
      duration: 55,
      timezone: DEFAULT_TIMEZONE,
      meetingLink: 'https://meet.google.com/arabic-labs',
      materials: [
        { name: 'Conversation Vocabulary List', url: 'https://files.waraqa.test/conversation-vocab.pdf', type: 'document' },
        { name: 'Audio Dialogue Pack', url: 'https://files.waraqa.test/dialogue-pack.mp3', type: 'audio' }
      ]
    }
  ];

  for (const config of configs) {
    const { title, description, subject, teacher, guardian, student, weekday, hour, minute, duration, timezone, meetingLink, materials } = config;

    const firstOccurrence = getUpcomingDate(weekday, hour, minute);
    const recurrenceDetails = [{
      dayOfWeek: weekday,
      time: toTimeString(hour, minute),
      duration,
      timezone
    }];

    const pattern = await Class.create({
      title,
      description,
      subject,
      teacher: teacher._id,
      student: {
        guardianId: guardian._id,
        studentId: student._id,
        studentName: `${student.firstName} ${student.lastName}`
      },
      scheduledDate: firstOccurrence,
      duration,
      timezone,
      anchoredTimezone: 'student',
      isRecurring: true,
      recurrence: {
        frequency: 'weekly',
        interval: 1,
        daysOfWeek: [weekday],
        generationPeriodMonths: 2,
        lastGenerated: new Date()
      },
      recurrenceDetails,
      status: 'pattern',
      meetingLink,
      materials,
      createdBy: admin._id
    });

    console.log(`📅 Created recurring pattern: ${title}`);

    for (let week = 0; week < 3; week += 1) {
      const scheduledDate = addWeeks(firstOccurrence, week);
      await Class.create({
        title: `${title} Session ${week + 1}`,
        description,
        subject,
        teacher: teacher._id,
        student: {
          guardianId: guardian._id,
          studentId: student._id,
          studentName: `${student.firstName} ${student.lastName}`
        },
        scheduledDate,
        duration,
        timezone,
        anchoredTimezone: 'student',
        isRecurring: false,
        parentRecurringClass: pattern._id,
        status: 'scheduled',
        meetingLink,
        createdBy: admin._id
      });
    }
  }
}

async function run() {
  try {
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    await resetCollections();

    const admin = await createAdmin();
    const teachers = await createTeachers();
    const guardians = await createGuardians(teachers);
    const students = await createStandaloneStudents(guardians);
    await updateTeacherRosters(teachers, students);
    await seedClassSeries(admin, teachers, guardians);

    console.log('\n🎉 Seed finished successfully!');
    console.log('   - Admin, teachers, guardians, and students inserted');
    console.log('   - Two recurring class series with upcoming sessions added');
    console.log('   - All counters reset to zero for fresh testing');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
    console.log('📤 Disconnected from MongoDB');
    process.exit();
  }
}

run();
