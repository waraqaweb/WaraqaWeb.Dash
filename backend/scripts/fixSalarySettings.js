/**
 * Fix Salary Settings - Manually create correct settings with rate partitions
 */

const mongoose = require('mongoose');
require('dotenv').config();

const SalarySettings = require('../models/SalarySettings');

async function fixSettings() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/waraqadb', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Delete existing settings
    console.log('🗑️  Deleting existing settings...');
    await SalarySettings.deleteMany({});
    console.log('✅ Deleted\n');

    // Create new settings with correct structure
    console.log('📝 Creating new settings with rate partitions...');
    const settings = await SalarySettings.create({
      _id: 'global',
      rateModel: 'progressive',
      ratePartitions: [
        { 
          name: '0-50h', 
          minHours: 0, 
          maxHours: 50, 
          rateUSD: 12, 
          description: 'Beginner tier - less than 50 hours', 
          isActive: true,
          effectiveFrom: new Date()
        },
        { 
          name: '51-100h', 
          minHours: 51, 
          maxHours: 100, 
          rateUSD: 15, 
          description: 'Intermediate tier - 51 to 100 hours', 
          isActive: true,
          effectiveFrom: new Date()
        },
        { 
          name: '101-200h', 
          minHours: 101, 
          maxHours: 200, 
          rateUSD: 18, 
          description: 'Advanced tier - 101 to 200 hours', 
          isActive: true,
          effectiveFrom: new Date()
        },
        { 
          name: '200+h', 
          minHours: 201, 
          maxHours: 999999, 
          rateUSD: 20, 
          description: 'Expert tier - over 200 hours', 
          isActive: true,
          effectiveFrom: new Date()
        }
      ],
      defaultTransferFee: {
        model: 'flat',
        value: 50
      },
      autoGenerateInvoices: true,
      generationDayOfMonth: 1,
      generationTimeUTC: '00:05'
    });

    console.log('✅ Settings created successfully!\n');
    console.log('Rate Partitions:');
    settings.ratePartitions.forEach(p => {
      const hourRange = p.maxHours > 500 ? `${p.minHours}+` : `${p.minHours}-${p.maxHours}`;
      console.log(`  • ${p.name}: $${p.rateUSD}/hour (${hourRange} hours)`);
    });

    console.log('\n✨ Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixSettings();
