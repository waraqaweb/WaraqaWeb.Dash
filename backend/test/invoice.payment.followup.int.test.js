const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('InvoiceService processInvoicePayment → follow-up creation (integration-ish)', function() {
  afterEach(() => sinon.restore());

  it('creates a follow-up invoice after payment and notifies guardian with PayPal link', async function() {
    // Guardian doc with a single student under threshold even after payment (exclude from balance)
    const guardianId = 'g-int-1';
    const studentId = 's-int-1';
    const guardianDoc = {
      _id: guardianId,
      role: 'guardian',
      firstName: 'Gina',
      lastName: 'Guardian',
      guardianInfo: {
        minLessonDurationMinutes: 60, // 1 hour threshold
        preferredPaymentMethod: 'paypal',
        students: [
          { _id: studentId, firstName: 'Stu', lastName: 'Dent', hoursRemaining: 0.25 }
        ],
        totalHours: 0.25
      },
      save: sinon.stub().resolves()
    };

    // Fake invoice doc returned by Invoice.findById().populate().exec()
    const prevEnd = new Date('2025-01-31T23:59:59.000Z');
    const fakeInvoiceDoc = {
      _id: 'inv-int-1',
      guardian: guardianId,
      status: 'sent',
      paidAmount: 0,
      items: [
        // Excluded from balance so student remains at 0.25 hours after payment
        { student: studentId, duration: 60, excludeFromStudentBalance: true }
      ],
      billingPeriod: { endDate: prevEnd },
      async processPayment(amount, method, txn, adminUserId, options) {
        this.status = 'paid';
        this.paidAmount = amount;
        return { invoice: this };
      }
    };

    // Stub Invoice.findById to return chainable populate().exec()
    const findByIdStub = sinon.stub().callsFake((id) => ({
      populate() { return { exec: async () => fakeInvoiceDoc }; }
    }));

    // Stub Invoice.findOne().sort() used in ensureNextInvoiceIfBelowThreshold to detect existing active invoice
    const findOneStub = sinon.stub().returns({ sort: () => Promise.resolve(null) });

    // Notification stubs
    const notifyInvoiceEventStub = sinon.stub().resolves();
    const createNotificationStub = sinon.stub().resolves({ _id: 'notif1' });

    // Wire service via proxyquire with model and service stubs
    // Provide a lightweight Invoice constructor so createZeroHourInvoice can run without a real DB
    function InvoiceModelStub(doc) {
      Object.assign(this, doc || {});
      this._id = this._id || 'stub-follow-1';
      this.ensureIdentifiers = async () => {};
      this.save = async () => {};
      this.populate = async () => {};
      this.recordAuditEntry = async () => {};
      this.pushActivity = () => {};
      this.recalculateTotals = () => {};
      this.recordDelivery = () => {};
    }
    InvoiceModelStub.findById = findByIdStub;
    InvoiceModelStub.findOne = findOneStub;

    const InvoiceService = proxyquire('../services/invoiceService', {
      '../models/Invoice': InvoiceModelStub,
      '../models/User': { findById: sinon.stub().resolves(guardianDoc) },
      '../services/notificationService': {
        notifyInvoiceEvent: notifyInvoiceEventStub,
        createNotification: createNotificationStub
      },
      // Guardian model used inside processInvoicePayment → ignore by returning null
      '../models/Guardian': { findOne: sinon.stub().resolves(null) }
    });

    // Overwrite createZeroHourInvoice to avoid Mongoose behaviors and return a predictable invoice
    const followInvoice = { _id: 'inv-follow-1', guardian: guardianId, paymentMethod: 'paypal', invoiceNumber: 'INV-FOLLOW-1' };
    InvoiceService.createZeroHourInvoice = async () => followInvoice;

    const res = await InvoiceService.processInvoicePayment('inv-int-1', {
      amount: 100,
      paymentMethod: 'paypal',
      transactionId: 'txn-int-1'
    }, 'admin-int-1');

    expect(res.success).to.equal(true);
  // ensure follow-up path was attempted and creation executed
    // We cannot reliably spy the internal static reference, but the debug log confirms invocation.
    // Ensure our follow-up invoice flow produced a user notification with a PayPal link.

    // notification for paid invoice + created follow-up should have been attempted
    expect(notifyInvoiceEventStub.called).to.equal(true);
    // Check that user-facing actionable notification for follow-up was created with a PayPal link
  const notifCalls = createNotificationStub.getCalls();
    const hasPaypalLink = notifCalls.some((c) => {
      const payload = c.args[0] || {};
      return payload.userId === guardianId
        && payload.actionRequired === true
        && typeof payload.actionLink === 'string'
        && payload.actionLink.includes('paypal.com/invoice/paying')
        && (payload.relatedId === 'inv-follow-1');
    });
    expect(hasPaypalLink).to.equal(true);
  });
});
