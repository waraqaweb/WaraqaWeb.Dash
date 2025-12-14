const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('POST /api/invoices/:id/items/preview', function () {
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
    sinon.stub(service, 'previewInvoiceChanges').resolves({ success: true, preview: true, invoice: { _id: 'i1' }, unsavedChanges: { total: 100 } });
  });

  after(function () {
    sinon.restore();
  });

  it('returns preview result for admin', async function () {
    const res = await request(app)
      .post('/api/invoices/i1/items/preview')
      .set('Authorization', 'Bearer test')
      .send({ addItems: [ { lessonId: 'L1', duration: 60, rate: 10 } ] });

    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('preview', true);
    expect(res.body).to.have.property('unsavedChanges');
  });
});
