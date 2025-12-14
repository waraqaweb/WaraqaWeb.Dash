const { expect } = require('chai');
const proxyquire = require('proxyquire');
const request = require('supertest');
const express = require('express');

describe('recomputeDashboardStats job', function() {
  it('computes payload and stores it (cache + mongo upsert stubbed)', async function() {
    // stub dashboardService to avoid hitting DB
    const dashboardServiceStub = {
      getUserStats: async () => ({ total: 10 }),
      getClassStats: async () => ({ scheduledToday: 2 }),
      getInvoiceStats: async () => ({ monthly: { total: 100 } }),
      getTeacherStats: async () => ({ teachersOnVacationCount: 0 }),
      getGuardianStats: async () => ({ topOwingGuardians: [] }),
      getGrowthStats: async () => ({ classesThisMonth: 5 })
    };

    // stub DashboardCache model so it doesn't hit Mongo
    const DashboardCacheStub = function() {};
    DashboardCacheStub.findOneAndUpdate = async () => ({ ok: 1 });

    const job = proxyquire('../jobs/recomputeDashboardStats', {
      '../services/dashboardService': dashboardServiceStub,
      '../models/DashboardCache': DashboardCacheStub,
      '../models/Class': { countDocuments: async () => 5, find: async () => [], aggregate: async () => [] },
      '../models/Invoice': { aggregate: async () => [] }
    });

    const result = await job.recomputeDashboardStats();
  expect(result).to.be.an('object');
  expect(result).to.have.property('summary');
  expect(result.summary).to.have.property('users');
  expect(result.summary.users).to.deep.equal({ total: 10 });
  expect(result).to.have.property('timestamps');
  expect(result.timestamps).to.have.property('computedAt');
  expect(result.timestamps).to.have.property('expiresAt');
  // new fields
  expect(result.summary).to.have.property('classes');
  expect(result.summary.classes).to.have.property('upcomingNext30');
  expect(result.summary.classes.upcomingNext30).to.be.a('number');
  expect(result.summary.classes).to.have.property('expectedNext30');
  expect(result.summary.classes.expectedNext30).to.be.a('number');
  expect(result.timestamps).to.have.property('nextAutoGeneration');
  expect(result.timestamps.nextAutoGeneration).to.be.instanceOf(Date);
  });

  it('POST /api/dashboard/refresh triggers recompute and returns timestamps (admin only)', async function() {
    // create app and mount dashboard route, but stub recomputeDashboardStats
    const app = express();
    // stub authentication to allow admin user
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    // simple stubs
    const sinon = require('sinon');
    sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'admin1' }));
    sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'admin1', role: 'admin', isActive: true }) }));

    // stub recompute to return known timestamps
    const jobs = require('../jobs/recomputeDashboardStats');
    const fakePayload = { summary: { users: { total: 1 } }, timestamps: { computedAt: new Date(), expiresAt: new Date(Date.now() + 1000 * 60) } };
    sinon.stub(jobs, 'recomputeDashboardStats').resolves(fakePayload);

    const dashboardRouter = require('../routes/dashboard');
    app.use('/api/dashboard', dashboardRouter);

    const res = await request(app).post('/api/dashboard/refresh').set('Authorization', 'Bearer admintoken');
    expect(res.status).to.equal(202);
    expect(res.body).to.have.property('refreshed', true);
    expect(res.body).to.have.property('timestamps');
    sinon.restore();
  });
});
