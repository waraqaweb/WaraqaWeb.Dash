const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('InvoiceService follow-up invoice generation', function() {
  afterEach(() => sinon.restore());

  it('creates follow-up invoice when smallest student <= min lesson duration and aligns period start', async function() {
    const guardianId = 'g1';
    const prevEnd = new Date('2025-01-31T23:59:59.000Z');

    // stub User.findById to return guardian with students and min lesson duration 60 mins
    const guardianDoc = {
      _id: guardianId,
      role: 'guardian',
      firstName: 'Gina',
      guardianInfo: {
        minLessonDurationMinutes: 60, // 1 hour threshold
        students: [
          { _id: 's1', firstName: 'A', lastName: 'One', hoursRemaining: 2 },
          { _id: 's2', firstName: 'B', lastName: 'Two', hoursRemaining: 0.5 }
        ],
        preferredPaymentMethod: 'paypal'
      }
    };

    const userFindById = sinon.stub().withArgs(guardianId).resolves(guardianDoc);

    // no existing active invoice
  const invoiceFindOne = sinon.stub().returns({ sort: () => Promise.resolve(null) });

    // load service with stubs
    const InvoiceService = proxyquire('../services/invoiceService', {
      '../models/User': { findById: userFindById },
      '../models/Invoice': { findOne: invoiceFindOne }
    });

    // stub createZeroHourInvoice to capture options and validate start alignment
    const czStub = sinon.stub(InvoiceService, 'createZeroHourInvoice').callsFake(async (gDoc, students, opts) => {
      expect(students).to.have.lengthOf(1);
      expect(String(students[0]._id)).to.equal('s2'); // smallest hoursRemaining
      expect(opts).to.have.property('billingPeriodStart');
      expect(new Date(opts.billingPeriodStart).toISOString()).to.equal(prevEnd.toISOString());
      expect(opts).to.have.property('reason', 'threshold_followup');
      return { _id: 'inv_new', billingPeriod: { startDate: opts.billingPeriodStart } };
    });

    const result = await InvoiceService.ensureNextInvoiceIfBelowThreshold(guardianId, { billingPeriod: { endDate: prevEnd } });
    expect(result.created).to.equal(true);
    expect(czStub.calledOnce).to.equal(true);
  });

  it('does nothing when smallest student above threshold', async function() {
    const guardianId = 'g2';
    const guardianDoc = {
      _id: guardianId,
      role: 'guardian',
      guardianInfo: {
        minLessonDurationMinutes: 30,
        students: [ { _id: 's1', hoursRemaining: 3 } ]
      }
    };

    const userFindById = sinon.stub().withArgs(guardianId).resolves(guardianDoc);

    const InvoiceService = proxyquire('../services/invoiceService', {
      '../models/User': { findById: userFindById },
      '../models/Invoice': { findOne: sinon.stub().resolves(null) }
    });

    const czStub = sinon.stub(InvoiceService, 'createZeroHourInvoice').resolves(null);

    const res = await InvoiceService.ensureNextInvoiceIfBelowThreshold(guardianId, null);
    expect(res.created).to.equal(false);
    expect(czStub.called).to.equal(false);
  });
});
