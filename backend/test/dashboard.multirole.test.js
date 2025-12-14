const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('GET /api/dashboard/stats (multi-role)', function () {
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

  it('returns admin stats payload', async function () {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    const Class = require('../models/Class');
    const Invoice = require('../models/Invoice');

    sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'admin1' }));
    sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'admin1', role: 'admin', isActive: true }) }));

    sinon.stub(User, 'aggregate').resolves([{ _id: 'teacher', count: 5 }, { _id: 'guardian', count: 20 }, { _id: 'student', count: 50 }]);
    sinon.stub(Class, 'aggregate').resolves([{ count: 123 }]);
    sinon.stub(Invoice, 'aggregate').resolves([{ total: 5000 }]);

    const res = await request(app).get('/api/dashboard/stats').set('Authorization', 'Bearer admintoken');
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('role', 'admin');
    expect(res.body).to.have.property('stats');
    expect(res.body.stats).to.have.property('users');
    expect(res.body.stats).to.have.property('revenue');
  });

  it('returns guardian stats payload', async function () {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    const Class = require('../models/Class');

    sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'guardian1' }));
    sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'guardian1', role: 'guardian', isActive: true }) }));

    // guardian-specific stubs
    sinon.stub(Class, 'find').resolves([]);
    sinon.stub(User, 'find').resolves([{ _id: 'guardian1', guardianInfo: { students: [] } }]);

    const res = await request(app).get('/api/dashboard/stats').set('Authorization', 'Bearer guidtoken');
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('role', 'guardian');
    expect(res.body).to.have.property('stats');
    // guardian stats should include upcomingClasses or monthlyBill keys
    expect(res.body.stats).to.be.an('object');
  });
});
