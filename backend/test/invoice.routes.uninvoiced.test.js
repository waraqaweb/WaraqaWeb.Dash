const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('GET /api/invoices/uninvoiced-lessons', function () {
  let app;

  before(function () {
    app = express();
    app.use(express.json());

    const router = require('../routes/invoices');
    app.use('/api/invoices', router);

    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'admin1' }));
    sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'admin1', role: 'admin', isActive: true, isLocked: false }) }));

    const audit = require('../services/invoiceAuditService');
    sinon.stub(audit, 'findUninvoicedLessons').resolves([
      { _id: 'c1', student: 's1', status: 'attended', billedInInvoiceId: null },
      { _id: 'c2', student: 's2', status: 'cancelled', billedInInvoiceId: null }
    ]);
  });

  after(function () {
    sinon.restore();
  });

  it('returns a list of uninvoiced lessons (admin only)', async function () {
    const res = await request(app)
      .get('/api/invoices/uninvoiced-lessons?sinceDays=30&includeCancelled=true')
      .set('Authorization', 'Bearer test');

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('lessons').that.is.an('array').with.lengthOf(2);
    expect(res.body.lessons[0]).to.include({ _id: 'c1' });
  });
});
