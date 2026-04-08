import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Mail,
  Phone,
  Sparkles,
  Users,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle
} from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../ui/LoadingSpinner';

const formatCurrency = (value, currency = 'USD') => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '$0.00';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(numeric);
  } catch (err) {
    return `$${numeric.toFixed(2)}`;
  }
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString();
};

const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return null;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
};

const maskPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return phone;
  const visibleEnd = digits.slice(-3);
  const visibleStart = digits.slice(0, Math.min(3, digits.length - 3));
  const masked = visibleStart + '*'.repeat(Math.max(1, digits.length - visibleStart.length - 3)) + visibleEnd;
  // Preserve leading + if present
  return phone.startsWith('+') ? '+' + masked : masked;
};

const STATUS_CONFIG = {
  completed:  { label: 'Completed', icon: CheckCircle2, bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  attended:   { label: 'Attended',  icon: CheckCircle2, bg: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-200' },
  scheduled:  { label: 'Scheduled', icon: Clock,        bg: 'bg-sky-50',     text: 'text-sky-700',     ring: 'ring-sky-200' },
  in_progress:{ label: 'In Progress', icon: Clock,      bg: 'bg-blue-50',    text: 'text-blue-700',    ring: 'ring-blue-200' },
  missed_by_student:     { label: 'Missed by student', icon: AlertTriangle, bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  no_show_both:          { label: 'No Show',   icon: AlertTriangle, bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  absent:                { label: 'Absent',    icon: AlertTriangle, bg: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-200' },
  cancelled:             { label: 'Cancelled', icon: XCircle,       bg: 'bg-red-50',   text: 'text-red-600',   ring: 'ring-red-200' },
  cancelled_by_teacher:  { label: 'Cancelled', icon: XCircle,       bg: 'bg-red-50',   text: 'text-red-600',   ring: 'ring-red-200' },
  cancelled_by_student:  { label: 'Cancelled', icon: XCircle,       bg: 'bg-red-50',   text: 'text-red-600',   ring: 'ring-red-200' },
  cancelled_by_guardian: { label: 'Cancelled', icon: XCircle,       bg: 'bg-red-50',   text: 'text-red-600',   ring: 'ring-red-200' },
  cancelled_by_admin:    { label: 'Cancelled', icon: XCircle,       bg: 'bg-red-50',   text: 'text-red-600',   ring: 'ring-red-200' },
  unreported:            { label: 'Unreported',icon: AlertCircle,   bg: 'bg-slate-50',  text: 'text-slate-500', ring: 'ring-slate-200' },
};

const ClassStatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || { label: status || '—', icon: Clock, bg: 'bg-slate-50', text: 'text-slate-500', ring: 'ring-slate-200' };
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${config.bg} ${config.text} ${config.ring}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
};

const InvoicePublicPage = () => {
  const { slug } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [branding, setBranding] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const fetchInvoice = async () => {
      try {
        setLoading(true);
        setError(null);
        const { data } = await api.get(`/invoices/public/${slug}`);
        if (cancelled) return;
        if (!data?.success) {
          setError(data?.message || 'Invoice could not be loaded.');
          return;
        }
        setInvoice(data.invoice || null);
      } catch (err) {
        if (!cancelled) {
          const message = err?.response?.data?.message || 'Unable to load this invoice.';
          setError(message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (slug) fetchInvoice();
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const fetchBranding = async () => {
      try {
        const { data } = await api.get('/settings/branding');
        if (!cancelled && data?.success) setBranding(data.branding);
      } catch (_) { /* branding is optional */ }
    };
    fetchBranding();
    return () => { cancelled = true; };
  }, []);

  const studentSummary = useMemo(() => {
    if (!invoice?.students) return [];
    return invoice.students.map((student) => ({
      name: student.name,
      lessons: student.lessons,
      hours: student.hours
    }));
  }, [invoice]);

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
            to="/login"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-white px-5 py-2 text-sm font-medium text-slate-900 shadow-sm transition hover:bg-white/90"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    );
  }

  const {
    invoiceName,
    invoiceNumber,
    status,
    billingPeriod,
    financials = {},
    guardian,
    notes,
    items = [],
    coverage
  } = invoice;

  const totalClasses = invoice?.counts?.lessonCount || items.length;
  const totalHours = invoice?.hours?.totalHoursRounded2 || invoice?.hours?.totalHours || 0;
  const currency = financials.currency || 'USD';
  const guardianName = guardian?.name || '—';
  const guardianEmail = guardian?.email || null;
  const guardianPhone = guardian?.phone || null;
  const coverageStrategy = coverage?.strategy;
  const isPaidStatus = ['paid', 'refunded'].includes(invoice?.status);
  const primaryAmount = isPaidStatus && Number(financials.paidAmount || 0) > 0
    ? financials.paidAmount
    : financials.total;
  const primaryLabel = isPaidStatus ? 'Paid' : 'Total';
  const maskedEmail = guardianEmail ? maskEmail(guardianEmail) : null;

  const logoUrl = branding?.logo?.url || branding?.logo?.dataUri || null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-14 sm:px-8">
        <header className="rounded-3xl bg-white/80 p-8 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {logoUrl ? (
                  <img src={logoUrl} alt={branding?.title || 'Logo'} className="h-10 w-auto object-contain" />
                ) : null}
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1 text-xs uppercase tracking-[0.3em] text-emerald-700">
                  <Sparkles className="h-3.5 w-3.5" />
                  {branding?.title || 'Waraqa'} invoice
                </span>
              </div>
              <h1 className="text-3xl font-semibold sm:text-4xl">{invoiceName || invoiceNumber}</h1>
              <p className="text-sm text-slate-600">
                Invoice number <span className="font-semibold text-slate-900">{invoiceNumber}</span>
                {billingPeriod?.label && (
                  <span className="ml-2 text-slate-500">• {billingPeriod.label}</span>
                )}
              </p>
              <div className="inline-flex items-center gap-3 rounded-full bg-slate-50 px-4 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                <FileText className="h-4 w-4" />
                {status || 'draft'}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-white p-6 text-sm text-slate-800 shadow-inner">
              <p className="text-xs uppercase tracking-wide text-slate-500">{primaryLabel}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{formatCurrency(primaryAmount, currency)}</p>
              <div className="mt-4 space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-slate-500" />
                  <span>{guardianName}</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Guardian</h2>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <p className="text-base font-semibold text-slate-900">{guardianName}</p>
              {maskedEmail && (
                <p className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-slate-500" />
                  <span className="text-slate-700">{maskedEmail}</span>
                </p>
              )}
              {guardianPhone && (
                <p className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-slate-500" />
                  <span className="text-slate-700">{maskPhone(guardianPhone)}</span>
                </p>
              )}
              <div className="mt-4 rounded-2xl border border-slate-100 bg-white/50 px-4 py-3 text-xs text-slate-700">
                <p>Total classes: <span className="font-semibold text-slate-900">{totalClasses}</span></p>
                <p>Total hours: <span className="font-semibold text-slate-900">{Number(totalHours).toFixed(2)}</span></p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Balance overview</h2>
            <div className="mt-3 grid gap-4 text-sm text-slate-700 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Subtotal</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(financials.subtotal, currency)}</p>
              </div>
              {Number(financials.paidAmount || 0) > 0 && (
                <div className="rounded-2xl border border-slate-100 bg-white p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Paid</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(financials.paidAmount, currency)}</p>
                </div>
              )}
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Transfer fee</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">
                  {financials.transferFee?.waived ? 'Waived' : formatCurrency(financials.transferFeeAmount, currency)}
                </p>
              </div>
            </div>
            {coverageStrategy && (
              <p className="mt-4 text-xs text-slate-500">Coverage strategy: <span className="text-slate-700">{coverageStrategy.replace(/_/g, ' ')}</span></p>
            )}
          </div>
        </section>

        {studentSummary.length > 0 && (
          <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Student summary</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {studentSummary.map((student) => (
                <div key={student.name} className="rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-700">
                  <p className="text-base font-semibold text-slate-900">{student.name}</p>
                  <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{student.lessons} classes</p>
                  <p className="text-xs text-slate-500">{Number(student.hours).toFixed(2)} hours</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Class sessions</h2>
            <p className="text-xs text-slate-500">{items.length} entries</p>
          </div>
          {items.length === 0 ? (
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
                    <th className="px-4 py-3">Teacher</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Hours</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item, idx) => (
                    <tr key={`${item.description}-${idx}`} className="bg-white">
                      <td className="px-4 py-3 text-slate-700">{item.date?.formatted || formatDate(item.date?.iso)}</td>
                      <td className="px-4 py-3 text-slate-900">{item.student?.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{item.teacher?.name || '—'}</td>
                      <td className="px-4 py-3"><ClassStatusBadge status={item.classStatus || item.attendanceStatus} /></td>
                      <td className="px-4 py-3 text-right text-slate-700">{Number(item.hours || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-right text-slate-900">{formatCurrency(item.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/80 text-sm font-semibold text-slate-900">
                  <tr className="border-b border-slate-200">
                    <td className="border-r border-slate-200 px-4 py-3" colSpan="4">Total ({items.length} classes)</td>
                    <td className="border-r border-slate-200 px-4 py-3 text-right">{Number(totalHours).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(financials.subtotal, currency)}</td>
                  </tr>
                  {Number(financials.transferFeeAmount || 0) > 0 && !financials.transferFee?.waived && (
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-600">
                      <td className="border-r border-slate-200 px-4 py-2" colSpan="5">Transfer fee</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(financials.transferFeeAmount, currency)}</td>
                    </tr>
                  )}
                  <tr className="text-base bg-slate-100/80">
                    <td className="border-r border-slate-200 px-4 py-3" colSpan="5">{primaryLabel}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(primaryAmount, currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        {/* Adjustments section on public invoice */}
        {Array.isArray(invoice.adjustments) && invoice.adjustments.length > 0 && (
          <section className="rounded-3xl border border-amber-100 bg-amber-50/30 p-6 shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">Adjustments</h2>
            <p className="mt-1 text-xs text-amber-600">Changes made after this invoice was finalized</p>
            <div className="mt-4 space-y-3">
              {invoice.adjustments.map((adj, idx) => {
                const isCredit = adj.type === 'credit';
                return (
                  <div key={adj._id || idx} className="flex items-start gap-3 rounded-xl bg-white/60 px-4 py-3">
                    <span className={`mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${isCredit ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {isCredit ? 'Credit' : 'Debit'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-slate-700">{adj.description}</p>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                        {adj.hoursDelta != null && <span>{adj.hoursDelta > 0 ? '+' : ''}{Number(adj.hoursDelta).toFixed(2)}h</span>}
                        {adj.amountDelta != null && <span>{adj.amountDelta > 0 ? '+' : ''}{formatCurrency(adj.amountDelta, currency)}</span>}
                        {adj.settled && <span className="text-emerald-600 font-medium">Settled</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            {(() => {
              const net = invoice.adjustments.filter(a => a.type === 'credit' && !a.settled).reduce((s, a) => s + Math.abs(a.amountDelta || 0), 0)
                - invoice.adjustments.filter(a => a.type === 'debit' && !a.settled).reduce((s, a) => s + Math.abs(a.amountDelta || 0), 0);
              if (net <= 0) return null;
              return <div className="mt-3 border-t border-amber-200 pt-3 text-xs font-semibold text-amber-800">Credit balance: {formatCurrency(net, currency)}</div>;
            })()}
          </section>
        )}

        {notes?.public && (
          <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lg">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Notes</h2>
            <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{notes.public}</p>
          </section>
        )}

        <footer className="mb-6 flex flex-col items-center gap-3 text-center text-xs text-slate-500">
          <span>Questions about this invoice? Reach out to your Waraqa coordinator.</span>
          <Link
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            to="/login"
          >
            <ArrowLeft className="h-4 w-4" />
            Go to Waraqa
          </Link>
        </footer>
      </div>
    </div>
  );
};

export default InvoicePublicPage;
