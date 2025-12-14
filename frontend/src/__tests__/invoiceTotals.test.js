import { computeInvoiceTotals } from '../utils/invoiceTotals';

describe('computeInvoiceTotals', () => {
  it('prefers adjustedTotal over total and amount', () => {
    const inv = { adjustedTotal: 50, total: 30, amount: 20, paidAmount: 0 };
    const res = computeInvoiceTotals(inv);
    expect(res.total).toBe(50);
  });

  it('falls back to total then amount', () => {
    const inv = { total: 40, amount: 20, paidAmount: 0 };
    const res = computeInvoiceTotals(inv);
    expect(res.total).toBe(40);
  });

  it('derives total from items when none present', () => {
    const inv = { items: [{ amount: 10 }, { amount: 15 }], paidAmount: 0 };
    const res = computeInvoiceTotals(inv);
    expect(res.total).toBe(25);
  });

  it('computes hours from items when hoursCovered missing', () => {
    const inv = { items: [{ duration: 60 }, { duration: 30 }] };
    const res = computeInvoiceTotals(inv);
    expect(res.hours).toBeCloseTo(1.5, 3);
  });

  it('uses stored transfer fee when available', () => {
    const inv = { total: 100, guardianFinancial: { transferFee: { amount: 5 } } };
    const res = computeInvoiceTotals(inv);
    expect(res.transferFee).toBe(5);
  });
});
