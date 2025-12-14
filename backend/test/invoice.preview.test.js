const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('InvoiceService previewInvoiceChanges', function() {
  afterEach(() => sinon.restore());

  it('returns unsaved changes summary without persisting', async function() {
    const invoiceId = 'inv-prev-1';
    const baseInvoice = {
      _id: invoiceId,
      items: [ { _id: 'it1', amount: 50, duration: 60 } ],
      subtotal: 50,
      total: 50,
      dueDate: new Date(),
      markModified: () => {},
      recalculateTotals: function () { this.subtotal = 70; this.total = 70; },
      save: sinon.stub().resolves(),
      updatedBy: null,
      $locals: {},
      pushActivity: () => {},
    };

    const findByIdStub = sinon.stub().withArgs(invoiceId).returns({ session: () => baseInvoice });

    const InvoiceService = proxyquire('../services/invoiceService', {
      '../models/Invoice': { findById: findByIdStub },
      '../models/User': {},
      mongoose: {
        startSession: async () => ({
          withTransaction: async (fn) => { await fn(); },
          endSession: async () => {}
        })
      }
    });

    const res = await InvoiceService.previewInvoiceChanges(invoiceId, {
      addItems: [ { _id: 'newA', amount: 20, duration: 60 } ]
    }, 'admin-prev');

    expect(res.success).to.equal(true);
    expect(res.preview).to.equal(true);
    expect(res.unsavedChanges).to.be.an('object');
    expect(res.unsavedChanges.added).to.be.an('array');
    expect(res.unsavedChanges.subtotal).to.equal(70);
  });
});
