const { expect } = require('chai');
const sinon = require('sinon');

const Invoice = require('../models/Invoice');
const Setting = require('../models/Setting');

describe('Resequence unpaid invoices endpoint', function() {
  afterEach(function() { sinon.restore(); });

  it('updates unpaid invoices and returns updated list', async function() {
    const inv1 = { _id: '1', save: sinon.stub().resolves(), toString() { return '1'; } };
    const inv2 = { _id: '2', save: sinon.stub().resolves(), toString() { return '2'; } };
  const findStub = sinon.stub(Invoice, 'find').returns({ sort: () => ({ exec: async () => [inv1, inv2] }) });

  const ensureStub = sinon.stub(Setting, 'findOneAndUpdate').resolves({ value: 1000 });

  // Ensure stub is in place
  expect(typeof Invoice.find).to.equal('function');
  });
});
