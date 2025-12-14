const { expect } = require('chai');
const mongoose = require('mongoose');
const Invoice = require('../models/Invoice');

const buildBaseInvoice = (overrides = {}) => {
  const now = new Date();
  return new Invoice({
    invoiceNumber: overrides.invoiceNumber || 'INV-TEST',
    type: 'guardian_invoice',
    guardian: overrides.guardian || new mongoose.Types.ObjectId(),
    billingPeriod: {
      startDate: now,
      endDate: now,
      month: now.getMonth() + 1,
      year: now.getFullYear()
    },
    dueDate: overrides.dueDate || now,
    items: overrides.items || [
      {
        description: 'Lesson',
        date: now,
        duration: 60,
        rate: 50
      }
    ],
    guardianFinancial: overrides.guardianFinancial,
    coverage: overrides.coverage,
    subtotal: overrides.subtotal,
    tax: overrides.tax,
    discount: overrides.discount,
    lateFee: overrides.lateFee
  });
};

describe('Invoice transfer fee calculations', () => {
  it('applies a fixed transfer fee to total', () => {
    const invoice = buildBaseInvoice({
      guardianFinancial: {
        transferFee: { mode: 'fixed', value: 5 }
      }
    });

    invoice.recalculateTotals();

    expect(invoice.guardianFinancial.transferFee.amount).to.equal(5);
    expect(invoice.total).to.equal(55);
  });

  it('applies a percentage-based transfer fee', () => {
    const invoice = buildBaseInvoice({
      items: [
        { description: 'Lesson', date: new Date(), duration: 120, rate: 50 }
      ],
      guardianFinancial: {
        transferFee: { mode: 'percent', value: 10 }
      }
    });

    invoice.recalculateTotals();

    expect(invoice.subtotal).to.equal(100);
    expect(invoice.guardianFinancial.transferFee.amount).to.equal(10);
    expect(invoice.total).to.equal(110);
  });

  it('waives the transfer fee when coverage requests it', () => {
    const invoice = buildBaseInvoice({
      guardianFinancial: {
        transferFee: { mode: 'fixed', value: 7 }
      },
      coverage: {
        waiveTransferFee: true
      }
    });

    invoice.recalculateTotals();

    expect(invoice.guardianFinancial.transferFee.amount).to.equal(0);
    expect(invoice.guardianFinancial.transferFee.waived).to.equal(true);
    expect(invoice.guardianFinancial.transferFee.waivedByCoverage).to.equal(true);
    expect(invoice.total).to.equal(50);
  });

  it('defaults transfer fee structure when missing', () => {
    const invoice = buildBaseInvoice({ guardianFinancial: {} });

    invoice.recalculateTotals();

    expect(invoice.guardianFinancial.transferFee.mode).to.equal('fixed');
    expect(invoice.guardianFinancial.transferFee.value).to.equal(0);
    expect(invoice.guardianFinancial.transferFee.amount).to.equal(0);
    expect(invoice.total).to.equal(50);
  });
});
