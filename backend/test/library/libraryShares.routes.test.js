const { expect } = require('chai');
const express = require('express');
const request = require('supertest');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();

const shareServiceStub = {
  submitShareRequest: sinon.stub().resolves({
    toObject: () => ({ id: 'share1', status: 'pending' })
  }),
  listMyRequests: sinon.stub().resolves([]),
  listRequests: sinon.stub().resolves([
    { toObject: () => ({ id: 'share-admin', status: 'pending' }) }
  ]),
  decideRequest: sinon.stub().resolves({ toObject: () => ({ id: 'decision', status: 'approved' }) }),
  revokeShare: sinon.stub().resolves({ toObject: () => ({ id: 'revoked', status: 'revoked' }) })
};

const authStub = {
  authenticateToken: (req, res, next) => {
    req.user = { _id: 'admin1', role: 'admin', email: 'admin@test.com' };
    next();
  },
  optionalAuth: (req, res, next) => {
    req.user = null;
    next();
  },
  requireAdmin: (req, res, next) => next()
};

const router = proxyquire('../../routes/libraryShares', {
  '../services/libraryShareService': shareServiceStub,
  '../middleware/auth': authStub
});

const app = express();
app.use(express.json());
app.use('/api/library/shares', router);

describe('libraryShares routes', () => {
  beforeEach(() => {
    Object.values(shareServiceStub).forEach((stub) => {
      if (stub.resetHistory) stub.resetHistory();
    });
  });

  it('creates share requests for guests', async () => {
    const res = await request(app)
      .post('/api/library/shares/requests')
      .send({ scopeType: 'folder', targetId: 'folder1', email: 'guest@test.com', fullName: 'Guest User' })
      .expect(201);

    expect(res.body.permission).to.include({ id: 'share1', status: 'pending' });
    sinon.assert.calledOnce(shareServiceStub.submitShareRequest);
  });

  it('lists requests for admins', async () => {
    const res = await request(app)
      .get('/api/library/shares/requests')
      .set('Authorization', 'Bearer fake')
      .expect(200);

    expect(res.body.permissions).to.be.an('array').with.lengthOf(1);
    expect(res.body.permissions[0]).to.include({ id: 'share-admin' });
  });
});
