const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

const Invoice = require('../models/Invoice');

describe('Invoice financial workflows', function() {
  afterEach(function() {
    sinon.restore();
  });

  describe('Invoice model payment processing', function() {
    it('marks invoice as paid when full amount is received', async function() {
      const invoice = new Invoice({
        invoiceNumber: 'INV-202401-0001',
        type: 'guardian_invoice',
        guardian: undefined,
        billingPeriod: {
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-01-31T00:00:00Z'),
          month: 1,
          year: 2024
        },
        items: [
          { description: 'Lesson 1', date: new Date('2024-01-05T10:00:00Z'), duration: 60, rate: 20, amount: 20 },
          { description: 'Lesson 2', date: new Date('2024-01-06T10:00:00Z'), duration: 60, rate: 20, amount: 20 }
        ],
        dueDate: new Date('2024-02-10T00:00:00Z')
      });

      sinon.stub(invoice, 'save').callsFake(async function() {
        return this;
      });
      sinon.stub(invoice, 'populate').resolves(invoice);

      const { invoice: updated } = await invoice.processPayment(40, 'cash', 'TXN-1', 'admin-1', { note: 'Full payment' });

      expect(updated.paidAmount).to.equal(40);
      expect(updated.status).to.equal('paid');
      expect(updated.paymentLogs).to.have.lengthOf(1);
      expect(updated.paymentLogs[0]).to.include({ amount: 40, paymentMethod: 'cash', transactionId: 'TXN-1' });
      expect(updated.tip).to.equal(0);
    });

    it('records partial payment and keeps invoice open', async function() {
      const invoice = new Invoice({
        invoiceNumber: 'INV-202401-0002',
        type: 'guardian_invoice',
        guardian: undefined,
        billingPeriod: {
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-01-31T00:00:00Z'),
          month: 1,
          year: 2024
        },
        items: [
          { description: 'Lesson 1', date: new Date('2024-01-05T10:00:00Z'), duration: 60, rate: 30, amount: 30 }
        ],
        dueDate: new Date('2024-02-10T00:00:00Z')
      });

      sinon.stub(invoice, 'save').callsFake(async function() { return this; });
      sinon.stub(invoice, 'populate').resolves(invoice);

      const { invoice: updated } = await invoice.processPayment(10, 'paypal', null, 'admin-2');

      expect(updated.paidAmount).to.equal(10);
      expect(updated.status).to.equal('sent');
      expect(updated.paymentLogs).to.have.lengthOf(1);
      expect(updated.remainingBalance).to.be.closeTo(updated.total - 10, 0.01);
    });
  });

  describe('Invoice service refund workflow', function() {
    it('reduces guardian balance and records refund', async function() {
      const guardianId = 'guardian1';
      const studentId = 'student1';

      const invoiceDoc = new Invoice({
        invoiceNumber: 'INV-202401-0100',
        type: 'guardian_invoice',
        guardian: { _id: guardianId },
        billingPeriod: {
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-01-31T00:00:00Z'),
          month: 1,
          year: 2024
        },
        items: [
          {
            description: 'Lesson 1',
            date: new Date('2024-01-05T10:00:00Z'),
            duration: 60,
            rate: 20,
            amount: 20,
            student: { _id: studentId }
          },
          {
            description: 'Lesson 2',
            date: new Date('2024-01-06T10:00:00Z'),
            duration: 60,
            rate: 20,
            amount: 20,
            student: { _id: studentId }
          }
        ],
        dueDate: new Date('2024-02-10T00:00:00Z'),
        paidAmount: 40,
        status: 'paid'
      });

      sinon.stub(invoiceDoc, 'save').callsFake(async function() { return this; });
      sinon.stub(invoiceDoc, 'populate').callsFake(async function() { return this; });

      const findByIdStub = sinon.stub().withArgs('inv-1').returns({
        populate: () => ({ exec: async () => invoiceDoc })
      });

      const guardianUser = {
        _id: guardianId,
        role: 'guardian',
        guardianInfo: {
          totalHours: 4,
          students: [
            {
              _id: studentId,
              firstName: 'Student',
              lastName: 'One',
              hoursRemaining: 4
            }
          ]
        },
        save: sinon.stub().resolves()
      };
      guardianUser.guardianInfo.students.id = (id) => guardianUser.guardianInfo.students.find((s) => String(s._id) === String(id));

      const studentUser = {
        _id: studentId,
        role: 'student',
        studentInfo: { hoursLeft: 4 },
        save: sinon.stub().resolves()
      };

      const userFindByIdStub = sinon.stub();
      userFindByIdStub.withArgs(guardianId).resolves(guardianUser);
      userFindByIdStub.withArgs(studentId).resolves(studentUser);

      const guardianModelDoc = { totalRemainingMinutes: 240, save: sinon.stub().resolves() };
      const guardianFindOneStub = sinon.stub().resolves(guardianModelDoc);

      const notificationStub = { notifyInvoiceEvent: sinon.stub().resolves() };

      const InvoiceService = proxyquire('../services/invoiceService', {
        '../models/Invoice': { findById: findByIdStub },
        '../models/User': { findById: userFindByIdStub },
        '../models/Guardian': { findOne: guardianFindOneStub },
        '../services/notificationService': notificationStub
      });

      const result = await InvoiceService.recordInvoiceRefund('inv-1', {
        amount: 20,
        refundHours: 1,
        reason: 'Make-good',
        refundReference: 'RF-1'
      }, 'admin-user');

      expect(result.success).to.equal(true);
      expect(invoiceDoc.paidAmount).to.equal(20);
      expect(invoiceDoc.status).to.equal('partially_paid'); // Changed from 'sent' to 'partially_paid'
      expect(invoiceDoc.paymentLogs).to.have.lengthOf(1);
      expect(invoiceDoc.paymentLogs[0].amount).to.equal(-20);
      expect(guardianUser.guardianInfo.totalHours).to.equal(3);
      expect(guardianUser.guardianInfo.students[0].hoursRemaining).to.equal(3);
      expect(guardianModelDoc.totalRemainingMinutes).to.equal(180);
      expect(notificationStub.notifyInvoiceEvent.calledOnce).to.equal(true);
    });
  });
});

describe('Invoice export snapshot', function() {
  it('produces aggregated summary with items, students, and financials', function() {
    const invoice = new Invoice({
      invoiceNumber: 'INV-202405-0001',
      type: 'guardian_invoice',
      guardian: {
        _id: 'guardian-1',
        firstName: 'Gina',
        lastName: 'Guardian',
        email: 'gina@example.com',
        phone: '+1234567890',
        timezone: 'Asia/Riyadh'
      },
      billingPeriod: {
        startDate: new Date('2024-05-01T00:00:00Z'),
        endDate: new Date('2024-05-31T23:59:59Z'),
        month: 5,
        year: 2024
      },
      dueDate: new Date('2024-06-05T00:00:00Z'),
      items: [
        {
          description: 'Lesson 1',
          date: new Date('2024-05-02T10:00:00Z'),
          duration: 60,
          rate: 20,
          amount: 20,
          student: { _id: 'student-1', firstName: 'Student', lastName: 'One', email: 's1@example.com' },
          teacher: { _id: 'teacher-1', firstName: 'Teacher', lastName: 'Alpha', email: 't1@example.com' },
          attended: true
        },
        {
          description: 'Lesson 2',
          date: new Date('2024-05-05T12:30:00Z'),
          duration: 90,
          rate: 22,
          amount: 33,
          student: { _id: 'student-2', firstName: 'Learner', lastName: 'Two', email: 's2@example.com' },
          teacher: { _id: 'teacher-1', firstName: 'Teacher', lastName: 'Alpha', email: 't1@example.com' },
          attendanceStatus: 'student_absent',
          attended: false
        }
      ],
      adjustments: [
        {
          reason: 'Scholarship',
          amount: 2,
          appliesTo: 'guardian',
          createdBy: 'admin-1',
          createdAt: new Date('2024-05-04T08:00:00Z')
        }
      ],
      subtotal: 53,
      discount: 5,
      tax: 2,
      total: 60,
      adjustedTotal: 58,
      paidAmount: 20,
      tip: 3,
      lateFee: 5,
      paymentLogs: [
        {
          amount: 20,
          method: 'cash',
          paymentMethod: 'cash',
          processedAt: new Date('2024-05-07T08:00:00Z'),
          note: 'Partial payment'
        }
      ],
      delivery: {
        status: 'sent',
        channels: [
          {
            channel: 'email',
            status: 'sent',
            attempt: 1,
            templateId: 'guardian-invoice',
            sentAt: new Date('2024-05-03T09:00:00Z'),
            createdAt: new Date('2024-05-03T09:00:00Z'),
            messageHash: 'hash-123'
          }
        ]
      },
      notes: 'Please settle soon.',
      internalNotes: 'High priority guardian'
    });

    const snapshot = invoice.getExportSnapshot({ timezone: 'UTC', locale: 'en-US' });

    expect(snapshot.invoiceNumber).to.equal('INV-202405-0001');
    expect(snapshot.counts.lessonCount).to.equal(2);
    expect(snapshot.hours.totalMinutes).to.equal(150);
    expect(snapshot.financials.total).to.equal(60);
    expect(snapshot.financials.remainingBalance).to.equal(38);
    expect(snapshot.dueDate).to.have.property('formatted');
    expect(snapshot.guardian).to.include({ name: 'Gina Guardian', email: 'gina@example.com' });
  expect(snapshot.students).to.have.lengthOf(2);
  const studentOne = snapshot.students.find((s) => s.name === 'Student One');
  expect(studentOne).to.exist;
  expect(studentOne).to.include({ lessons: 1 });
  expect(snapshot.teachers).to.be.an('array').that.is.not.empty;
  const totalTeacherMinutes = snapshot.teachers.reduce((sum, t) => sum + (t.minutes || 0), 0);
  expect(totalTeacherMinutes).to.equal(snapshot.hours.totalMinutes);
    expect(snapshot.items).to.have.lengthOf(2);
    expect(snapshot.items[0]).to.include.keys('description', 'hours', 'amount');
    expect(snapshot.delivery.status).to.equal('sent');
    expect(snapshot.paymentLogs).to.have.lengthOf(1);
  });

  it('omits heavy collections when includeItems is false', function() {
    const invoice = new Invoice({
      invoiceNumber: 'INV-202405-0002',
      type: 'guardian_invoice',
      guardian: { _id: 'guardian-2', firstName: 'Gary', lastName: 'Green' },
      billingPeriod: {
        startDate: new Date('2024-05-01T00:00:00Z'),
        endDate: new Date('2024-05-31T23:59:59Z'),
        month: 5,
        year: 2024
      },
      items: [
        {
          description: 'Lesson 1',
          date: new Date('2024-05-10T10:00:00Z'),
          duration: 60,
          rate: 25,
          amount: 25,
          student: { _id: 'student-3', firstName: 'Sam', lastName: 'Three' },
          teacher: { _id: 'teacher-2', firstName: 'Tess', lastName: 'Beta' }
        }
      ],
      subtotal: 25,
      total: 25
    });

    const compact = invoice.getExportSnapshot({ includeItems: false, includePayments: false });

    expect(compact.counts.lessonCount).to.equal(1);
    expect(compact.items).to.be.an('array').that.is.empty;
    expect(compact.paymentLogs).to.be.an('array').that.is.empty;
    expect(compact.students[0].hours).to.equal(1);
  });
});
