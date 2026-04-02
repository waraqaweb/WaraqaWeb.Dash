import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Calendar,
  DollarSign,
  Clock,
  AlertCircle,
  Check,
  Users,
  ArrowRightLeft,
  Wallet,
  Sparkles
} from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';

const formatCurrency = (amount, currency = 'EGP') => {
  const value = Number(amount) || 0;
  return currency === 'USD' ? `$${value.toFixed(2)}` : `${value.toFixed(2)} EGP`;
};

const formatDateWithDay = (date) => {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const TeacherInvoicePublicPage = () => {
  const { token } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchInvoice = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get(`/teacher-salary/shared/${token}`);
        if (cancelled) return;
        if (!data?.success) {
          setError(data?.message || 'Invoice could not be loaded.');
          return;
        }
        setInvoice(data.invoice || null);
      } catch (err) {
        if (!cancelled) {
          setError(err?.response?.data?.error || 'Unable to load this invoice.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (token) fetchInvoice();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex items-center justify-center px-6 py-12">
        <div className="max-w-md rounded-3xl bg-white p-8 text-center text-slate-900 shadow-xl backdrop-blur">
          <AlertCircle className="mx-auto h-12 w-12 text-amber-400" />
          <h1 className="mt-4 text-2xl font-semibold">Invoice unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error || 'This invoice link may be expired or invalid.'}</p>
          <Link
            to="/dashboard/login"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-5 py-2 text-sm font-medium text-slate-900 shadow-sm transition hover:bg-white/90 border border-slate-200"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  const teacherName = invoice.teacher
    ? `${invoice.teacher.firstName || ''} ${invoice.teacher.lastName || ''}`.trim()
    : '—';
  const periodLabel = invoice.month && invoice.year
    ? `${MONTH_NAMES[invoice.month - 1]} ${invoice.year}`
    : '—';
  const totalHours = invoice.totalHours || 0;
  const hourlyRate = invoice.rateSnapshot?.rate || 0;
  const exchangeRate = invoice.exchangeRateSnapshot?.rate || 1;
  const classes = invoice.classes || [];
  const isPaid = invoice.status === 'paid';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-14 sm:px-8">

        {/* Header */}
        <header className="rounded-3xl bg-white/80 p-8 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1 text-xs uppercase tracking-[0.3em] text-emerald-700">
                <Sparkles className="h-3.5 w-3.5" />
                Teacher salary invoice
              </span>
              <h1 className="text-3xl font-semibold sm:text-4xl">{invoice.invoiceNumber || '—'}</h1>
              <p className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{teacherName}</span>
                <span className="ml-2 text-slate-500">• {periodLabel}</span>
              </p>
              <div className="inline-flex items-center gap-3 rounded-full bg-slate-50 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                <FileText className="h-4 w-4" />
                {invoice.status || 'draft'}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-6 text-sm text-slate-800 shadow-inner">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {isPaid ? 'Paid' : 'Net Amount'}
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                {formatCurrency(invoice.netAmountEGP, 'EGP')}
              </p>
              <div className="mt-4 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-slate-500" />
                  <span>{teacherName}</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Summary Cards */}
        <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Hours</h2>
              <Clock className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{totalHours.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-1">{classes.length} classes</p>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hourly Rate</h2>
              <DollarSign className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">${hourlyRate.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-1">{invoice.rateSnapshot?.partition || 'Standard'}</p>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Exchange Rate</h2>
              <ArrowRightLeft className="h-4 w-4 text-slate-400" />
            </div>
            <p className="text-2xl font-bold text-slate-900">{exchangeRate.toFixed(2)}</p>
            <p className="text-xs text-slate-500 mt-1">EGP per USD</p>
          </div>

          <div className="rounded-3xl border border-green-100 bg-gradient-to-br from-green-50 to-emerald-50 p-6 shadow-lg">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-green-700">Net Amount</h2>
              <Wallet className="h-4 w-4 text-green-600" />
            </div>
            <p className="text-2xl font-bold text-green-700">{formatCurrency(invoice.netAmountEGP, 'EGP')}</p>
            <p className="text-xs text-green-600 mt-1">After transfer fee</p>
          </div>
        </section>

        {/* Payment Info */}
        {isPaid && invoice.paidAt && (
          <section className="rounded-3xl border border-green-200 bg-green-50 p-6 shadow-lg flex items-start gap-3">
            <div className="p-2 bg-green-500 rounded-lg">
              <Check className="w-5 h-5 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-green-900 mb-1">Payment Confirmed</h4>
              <p className="text-sm text-green-800">
                Paid on {formatDateWithDay(invoice.paidAt)}
                {invoice.paymentMethod && ` via ${invoice.paymentMethod}`}
              </p>
            </div>
          </section>
        )}

        {/* Financial Summary */}
        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Financial Summary</h2>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between py-1">
              <span className="text-slate-700">Base Salary (USD)</span>
              <span className="font-semibold text-slate-900">{formatCurrency(invoice.grossAmountUSD, 'USD')}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 py-1 border-t border-slate-100">
              <span className="italic">{totalHours.toFixed(2)} hrs × ${hourlyRate.toFixed(2)}/hr</span>
            </div>
            {(invoice.bonusesUSD || 0) > 0 && (
              <div className="flex items-center justify-between py-1 border-t border-slate-100">
                <span className="text-slate-700">Bonuses (USD)</span>
                <span className="font-semibold text-green-700">+{formatCurrency(invoice.bonusesUSD, 'USD')}</span>
              </div>
            )}
            {(invoice.extrasUSD || 0) !== 0 && (
              <div className="flex items-center justify-between py-1 border-t border-slate-100">
                <span className="text-slate-700">Extras (USD)</span>
                <span className="font-semibold text-slate-900">{formatCurrency(invoice.extrasUSD, 'USD')}</span>
              </div>
            )}
            <div className="flex items-center justify-between py-2 border-t border-slate-200">
              <span className="text-slate-700">Converted to EGP</span>
              <span className="font-semibold text-slate-900">{formatCurrency(invoice.grossAmountEGP, 'EGP')}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500 py-1">
              <span className="italic">Rate: {exchangeRate.toFixed(2)} EGP/USD</span>
            </div>
            <div className="flex items-center justify-between py-1 border-t border-slate-100">
              <span className="text-slate-700">Subtotal (EGP)</span>
              <span className="font-semibold text-slate-900">{formatCurrency(invoice.totalEGP, 'EGP')}</span>
            </div>
            <div className="flex items-center justify-between py-1 border-t border-slate-100">
              <span className="text-slate-700">Transfer Fee</span>
              <span className="font-semibold text-slate-900">- {formatCurrency(invoice.transferFeeEGP, 'EGP')}</span>
            </div>
            <div className="flex items-center justify-between py-2 border-t-2 border-slate-300">
              <span className="font-semibold text-slate-900">Net Amount (EGP)</span>
              <span className="text-lg font-bold text-green-700">{formatCurrency(invoice.netAmountEGP, 'EGP')}</span>
            </div>
          </div>
        </section>

        {/* Classes Table */}
        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Classes</h2>
            <p className="text-xs text-slate-500">{classes.length} entries</p>
          </div>
          {classes.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-slate-100 bg-white/50 px-4 py-10 text-center text-sm text-slate-500">
              No classes recorded for this invoice period.
            </div>
          ) : (
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-100">
              <table className="min-w-full divide-y divide-slate-100 text-left text-sm text-slate-700">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Student</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3 text-right">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {classes.map((cls, idx) => (
                    <tr key={cls._id || idx} className="bg-white">
                      <td className="px-4 py-3 text-slate-700">{formatDateWithDay(cls.date)}</td>
                      <td className="px-4 py-3 text-slate-900">{cls.studentName || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{cls.subject || '—'}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{(cls.hours || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50">
                  <tr>
                    <td colSpan="3" className="px-4 py-3 font-semibold text-slate-900">Total</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">{totalHours.toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Notes */}
        {invoice.notes && (
          <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Notes</h2>
            <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{invoice.notes}</p>
          </section>
        )}

        <footer className="mb-6 flex flex-col items-center gap-3 text-center text-xs text-slate-500">
          <span>Questions about this invoice? Reach out to your Waraqa coordinator.</span>
          <Link
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            to="/dashboard/login"
          >
            <ArrowLeft className="h-4 w-4" />
            Go to Waraqa
          </Link>
        </footer>
      </div>
    </div>
  );
};

export default TeacherInvoicePublicPage;
