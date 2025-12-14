const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('POST /api/invoices/:id/refund', function () {
  let app;
  let service;

  before(function () {
    app = express();
    app.use(express.json());

    const router = require('../routes/invoices');
    app.use('/api/invoices', router);

    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'admin1' }));
    sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'admin1', role: 'admin', isActive: true, isLocked: false }) }));

    service = require('../services/invoiceService');
    sinon.stub(service, 'recordInvoiceRefund').resolves({ success: true, invoice: { _id: 'inv1' } });
  });

  after(function () {
    sinon.restore();
  });

  it('rejects requests without refund hours', async function () {
    const res = await request(app)
      .post('/api/invoices/inv1/refund')
      .set('Authorization', 'Bearer token')
      .send({ refundAmount: 10, reason: 'Test refund' });

    expect(res.status).to.equal(400);
    expect(res.body.message || res.body.error).to.match(/refund hours/i);
  });

  it('delegates to service with normalized payload', async function () {
    const res = await request(app)
      .post('/api/invoices/inv2/refund')
      .set('Authorization', 'Bearer token')
      .send({ refundAmount: 25, refundHours: 2.5, reason: 'Adjustment', refundReference: 'abc123' });

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(service.recordInvoiceRefund.calledOnce).to.be.true;
    const [, payload] = service.recordInvoiceRefund.lastCall.args;
    expect(payload).to.include({ amount: 25, refundHours: 2.5, reason: 'Adjustment', refundReference: 'abc123' });
  });
});
