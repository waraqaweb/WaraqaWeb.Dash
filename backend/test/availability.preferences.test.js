const proxyquire = require('proxyquire');
const { expect } = require('chai');

describe('AvailabilityService preference filtering', function() {
  it('excludes teachers outside requested age range', async function() {
    // Stubbed dependencies
    const mockTeachers = [
      { _id: 't1', firstName: 'A', lastName: 'One', timezone: 'UTC', teacherInfo: { preferredStudentAgeRange: { min: 10, max: 15 }, availabilityStatus: 'default_24_7' } },
      { _id: 't2', firstName: 'B', lastName: 'Two', timezone: 'UTC', teacherInfo: { preferredStudentAgeRange: { min: 3, max: 70 }, availabilityStatus: 'default_24_7' } }
    ];

    const UserStub = {
      find: () => ({
        populate: async () => mockTeachers
      })
    };

    const AvailabilitySlotStub = {
      find: async () => [
        { startTime: '10:00', endTime: '12:00', timezone: 'UTC' }
      ]
    };
    const UnavailableStub = {
      find: () => ({ select: async () => [] })
    };
    const ClassStub = {
      find: () => ({ select: async () => [] })
    };
    const tzUtilsStub = {
      DEFAULT_TIMEZONE: 'UTC',
      convertTimezone: (date) => date,
      formatTimeInTimezone: (date) => {
        const iso = date.toISOString().split('T')[1];
        return iso ? iso.slice(0, 5) : '00:00';
      },
      convertToUTC: (dateString) => {
        if (!dateString) return new Date();
        const normalized = dateString.replace(' ', 'T');
        return new Date(`${normalized}:00Z`);
      },
      convertFromUTC: (date) => date
    };

    const svc = proxyquire('../services/availabilityService', {
      '../models/User': UserStub,
      '../models/AvailabilitySlot': AvailabilitySlotStub,
      '../models/UnavailablePeriod': UnavailableStub,
      '../models/Class': ClassStub,
      '../utils/timezoneUtils': tzUtilsStub
    });

    const payload = {
      studentAvailability: { preferredDays: [1], timeSlots: [{ startTime: '10:00', endTime: '11:00' }], duration: 60 },
      additionalCriteria: { ageRange: { min: 5, max: 9 } }
    };

    const { results } = await svc.searchTeachersForSharing(payload, 'UTC');
    // t1 prefers 10-15 so should be excluded for ageRange 5-9; only t2 should remain
    expect(results.exactMatches.length + results.flexibleMatches.length).to.equal(1);
    const names = results.exactMatches.concat(results.flexibleMatches).map(r=> r.teacher.name);
    expect(names[0]).to.match(/Two/);
  });
});
