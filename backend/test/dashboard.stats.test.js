const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('GET /api/dashboard/stats - admin KPIs', function () {
  let app;

  beforeEach(function () {
    app = express();
    app.use((req, res, next) => { next(); });
    const dashboardRouter = require('../routes/dashboard');
    app.use('/api/dashboard', dashboardRouter);
  });

  afterEach(function () {
    sinon.restore();
  });

  it('returns additional admin KPI fields with expected shapes', async function () {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    const Class = require('../models/Class');
    const Invoice = require('../models/Invoice');

    sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'admin1' }));
    sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'admin1', role: 'admin', isActive: true }) }));

    sinon.stub(User, 'aggregate').resolves([{ _id: 'teacher', count: 5 }, { _id: 'guardian', count: 20 }, { _id: 'student', count: 50 }]);
    sinon.stub(Class, 'aggregate').resolves([{ _id: 'scheduled', count: 10 }]);
    sinon.stub(Invoice, 'aggregate').resolves([{ total: 5000 }]);

    const res = await request(app).get('/api/dashboard/stats').set('Authorization', 'Bearer admintoken');
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('role', 'admin');
    expect(res.body).to.have.property('stats');

    const s = res.body.stats;
    expect(s).to.have.property('users');
    expect(s).to.have.property('revenue');
    // new fields
    expect(s).to.have.property('topOwingGuardians');
    expect(Array.isArray(s.topOwingGuardians)).to.be.true;
    expect(s).to.have.property('classesWithoutReportsCount');
    expect(typeof s.classesWithoutReportsCount).to.equal('number');
    expect(s).to.have.property('pendingReschedulesCount');
    expect(typeof s.pendingReschedulesCount).to.equal('number');
    expect(s).to.have.property('teachersOnVacationCount');
    expect(typeof s.teachersOnVacationCount).to.equal('number');
  });
});
