const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('POST /api/invoices/:id/rollback', function () {
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

    const service = require('../services/invoiceService');
    sinon.stub(service, 'rollbackInvoiceChange').resolves({ success: true, invoice: { _id: 'i1' } });
  });

  after(function () {
    sinon.restore();
  });

  it('rolls back an audit entry', async function () {
    const res = await request(app)
      .post('/api/invoices/i1/rollback')
      .set('Authorization', 'Bearer test')
      .send({ auditId: 'a1' });

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
  });
});
