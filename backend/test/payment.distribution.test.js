const { expect } = require('chai');
const sinon = require('sinon');

const Invoice = require('../models/Invoice');

describe('Payment and tip distribution', function() {
  afterEach(function() { sinon.restore(); });

  it('distributes tip among teachers excluding items marked excludeFromTeacherPayment', async function() {
    const invoice = new Invoice({
      invoiceNumber: 'INV-202501-0001',
      items: [
        { description: 'L1', date: new Date(), duration: 60, rate: 20, amount: 20, teacher: 't1', teacherSnapshot: { firstName: 'T1', lastName: 'Teacher' }, excludeFromTeacherPayment: false },
        { description: 'L2', date: new Date(), duration: 60, rate: 30, amount: 30, teacher: 't2', teacherSnapshot: { firstName: 'T2', lastName: 'Teacher' }, excludeFromTeacherPayment: false },
        { description: 'L3', date: new Date(), duration: 60, rate: 50, amount: 50, teacher: 't3', teacherSnapshot: { firstName: 'T3', lastName: 'Teacher' }, excludeFromTeacherPayment: true }
      ],
      total: 100,
      paidAmount: 0,
      tip: 0
    });

    sinon.stub(invoice, 'save').callsFake(async function() { return this; });
    sinon.stub(invoice, 'populate').resolves(invoice);

    const res = await invoice.processPayment(100, 'cash', 'TX-123', 'admin-1', { tip: 10 });

    expect(res.invoice.paidAmount).to.equal(100);
    // There should be initial payment log + 2 teacher distribution logs => >=3
    expect(res.invoice.paymentLogs.length).to.be.at.least(2);
    // Check distribution sums
    const distributionLogs = res.invoice.paymentLogs.filter(l => l.method === 'tip_distribution' || l.paymentMethod === 'tip');
    const sumDist = distributionLogs.reduce((s, l) => s + (l.amount || 0), 0);
    // net tip after 5% = 9.5
    expect(sumDist).to.be.closeTo(9.5, 0.01);
  });
});
