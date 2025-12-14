const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('POST /api/invoices/:id/adjustments', function () {
  let app;

  before(function () {
    app = express();
    app.use(express.json());

    // mount router
    const router = require('../routes/invoices');
    app.use('/api/invoices', router);

    // stub auth
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'admin1' }));
    sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'admin1', role: 'admin', isActive: true, isLocked: false }) }));

    // stub service
    const service = require('../services/invoiceService');
    sinon.stub(service, 'applyPostPaymentAdjustment').resolves({ success: true, invoice: { _id: 'i1' } });
  });

  after(function () {
    sinon.restore();
  });

  it('applies an increase adjustment', async function () {
    const res = await request(app)
      .post('/api/invoices/i1/adjustments')
      .set('Authorization', 'Bearer test')
      .send({ type: 'increase', addItems: [{ duration: 30, rate: 10, amount: 5 }] });

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });
});
