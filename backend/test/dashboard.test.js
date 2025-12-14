const request = require('supertest');
const express = require('express');
const sinon = require('sinon');
const { expect } = require('chai');

describe('GET /api/dashboard/stats (teacher)', function () {
  let app;

  before(function () {
    app = express();

    // inject a fake authenticated teacher user
    app.use((req, res, next) => {
      // leave req.user unset; the auth middleware will set it after we stub jwt/User
      next();
    });

    // require router after stubbing will be done below
    const dashboardRouter = require('../routes/dashboard');
    app.use('/api/dashboard', dashboardRouter);

  // stub model methods and auth helpers
  const Class = require('../models/Class');
  const Invoice = require('../models/Invoice');
  const jwt = require('jsonwebtoken');
  const User = require('../models/User');

  // stub jwt.verify to return a decoded token pointing to our test teacher id
  sinon.stub(jwt, 'verify').callsFake(() => ({ userId: 'teacher1' }));

  // stub User.findById to behave like a mongoose query with .select()
  sinon.stub(User, 'findById').callsFake(() => ({ select: async () => ({ _id: 'teacher1', role: 'teacher', isActive: true, isLocked: false }) }));

    sinon.stub(Class, 'aggregate').callsFake((pipeline) => {
      const execFn = async () => {
        if (Array.isArray(pipeline) && pipeline.some(p => p.$lookup)) {
          return [ { _id: 'class1', scheduledDate: new Date().toISOString(), student: { studentName: 'A' } } ];
        }
        if (Array.isArray(pipeline) && pipeline.some(p => p.$group && p.$group._id === '$status')) {
          return [ { _id: 'attended', count: 2, totalMinutes: 120 } ];
        }
        if (Array.isArray(pipeline) && pipeline.some(p => p.$group && String(p.$group._id) === '$student.studentId')) {
          return [ { count: 3 } ];
        }
        return [];
      };

      // create an object that's both thenable (so await works) and has exec()
      const ret = {
        exec: execFn,
        then: (onFulfill, onReject) => execFn().then(onFulfill, onReject)
      };

      return ret;
    });

    sinon.stub(Class, 'findOne').callsFake(() => ({
      populate: () => ({ lean: async () => ({ _id: 'next1', scheduledDate: new Date().toISOString(), title: 'Next' }) })
    }));

    sinon.stub(Class, 'find').callsFake(() => ({ limit: () => ({ populate: () => ({ lean: async () => [] }) }) }));

    sinon.stub(Invoice, 'aggregate').resolves([ { total: 150 } ]);
  });

  after(function () {
    sinon.restore();
  });

  it('returns teacher stats payload', async function () {
    const res = await request(app).get('/api/dashboard/stats').set('Authorization', 'Bearer testtoken');
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('success', true);
    expect(res.body).to.have.property('role', 'teacher');
    expect(res.body).to.have.property('stats');
    expect(res.body.stats).to.have.property('hoursThisMonth');
    expect(res.body.stats).to.have.property('pendingFirstClassStudents');
  });
});
