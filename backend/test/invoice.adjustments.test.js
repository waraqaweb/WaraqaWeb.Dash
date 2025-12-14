const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('InvoiceService post-payment adjustments', function() {
  afterEach(() => sinon.restore());

  it('applies reduction and notifies when guardian could go negative', async function() {
    const invoiceId = 'inv-red-1';
    const guardianId = 'g-red-1';

    const invoiceDoc = {
      _id: invoiceId,
      status: 'paid',
      guardian: guardianId,
      recordAuditEntry: sinon.stub().resolves(),
    };

    const InvoiceModelStub = {
      findById: sinon.stub().withArgs(invoiceId).returns({ populate: () => ({ exec: async () => invoiceDoc }) })
    };

    const guardianDoc = { _id: guardianId, firstName: 'Gina', guardianInfo: { totalHours: -1 } };
    const UserModelStub = { findById: sinon.stub().resolves(guardianDoc) };

    const notifySystemStub = sinon.stub().resolves();
    const createNotificationStub = sinon.stub().resolves();

    const InvoiceService = proxyquire('../services/invoiceService', {
      '../models/Invoice': InvoiceModelStub,
      '../models/User': UserModelStub,
      '../services/notificationService': {
        notifySystem: notifySystemStub,
        createNotification: createNotificationStub,
      }
    });

    // Short-circuit underlying refund path; we only validate that notifications flow
    const refundStub = sinon.stub(InvoiceService, 'recordInvoiceRefund').resolves({ success: true, invoice: invoiceDoc });

    const res = await InvoiceService.applyPostPaymentAdjustment(invoiceId, {
      type: 'reduction',
      amount: 20,
      refundHours: 1,
      reason: 'test'
    }, 'admin-1');

    expect(res.success).to.equal(true);
    expect(refundStub.calledOnce).to.equal(true);
    expect(UserModelStub.findById.called).to.equal(true);
    expect(notifySystemStub.called).to.equal(true);
    expect(createNotificationStub.called).to.equal(true);
  });

  it('removes lessons and can perform both refund and compensation', async function() {
    const invoiceId = 'inv-rem-1';
    const itemId = 'item-1';
    const invoiceBefore = {
      _id: invoiceId,
      status: 'paid',
      items: [ { _id: itemId, amount: 30, duration: 60, student: 's1' } ],
      recordAuditEntry: sinon.stub().resolves(),
    };
    const findByIdReturn = Object.assign({}, invoiceBefore);
    findByIdReturn.populate = () => ({ exec: async () => invoiceBefore });
    const InvoiceModelStub = { findById: sinon.stub().withArgs(invoiceId).returns(findByIdReturn) };

    const notifySystemStub = sinon.stub().resolves();

    const InvoiceService = proxyquire('../services/invoiceService', {
      '../models/Invoice': InvoiceModelStub,
      '../models/User': {},
      '../services/notificationService': { notifySystem: notifySystemStub }
    });

    const updateStub = sinon.stub(InvoiceService, 'updateInvoiceItems').resolves({ success: true, invoice: invoiceBefore });
    const refundStub = sinon.stub(InvoiceService, 'recordInvoiceRefund').resolves({ success: true, invoice: invoiceBefore });

    const res = await InvoiceService.applyPostPaymentAdjustment(invoiceId, {
      type: 'removeLessons',
      itemIds: [itemId],
      mode: 'both'
    }, 'admin-2');

    // debug
    // eslint-disable-next-line no-console
    console.log('removeLessons result:', res, { updateCalled: updateStub.called, refundCalled: refundStub.called });

    expect(res.success).to.equal(true);
    expect(updateStub.calledOnce).to.equal(true);
    expect(refundStub.calledOnce).to.equal(true);
    expect(notifySystemStub.calledOnce).to.equal(true);
  });
});
