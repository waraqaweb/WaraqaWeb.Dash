import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  Mail,
  Phone,
  Sparkles,
  Users,
  AlertCircle
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

const InvoicePublicPage = () => {
  const { slug } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-14 sm:px-8">
        <header className="rounded-3xl bg-white/80 p-8 shadow-sm ring-1 ring-black/5">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-1 text-xs uppercase tracking-[0.3em] text-emerald-700">
                <Sparkles className="h-3.5 w-3.5" />
                Waraqa invoice
              </span>
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
              <p className="text-xs uppercase tracking-wide text-slate-500">Amount due</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{formatCurrency(financials.total, currency)}</p>
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
              {guardianEmail && (
                <p className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-slate-500" />
                  <a href={`mailto:${guardianEmail}`} className="hover:text-emerald-600 text-slate-700">{guardianEmail}</a>
                </p>
              )}
              {guardianPhone && (
                <p className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-slate-500" />
                  <a href={`tel:${guardianPhone}`} className="hover:text-emerald-600 text-slate-700">{guardianPhone}</a>
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
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Paid</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(financials.paidAmount, currency)}</p>
              </div>
              <div className="rounded-2xl border border-slate-100 bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Remaining</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{formatCurrency(financials.remainingBalance, currency)}</p>
              </div>
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
                    <th className="px-4 py-3">Hours</th>
                    <th className="px-4 py-3">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item, idx) => (
                    <tr key={`${item.description}-${idx}`} className="bg-white">
                      <td className="px-4 py-3 text-slate-700">{item.date?.formatted || formatDate(item.date?.iso)}</td>
                      <td className="px-4 py-3 text-slate-900">{item.student?.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{item.teacher?.name || '—'}</td>
                      <td className="px-4 py-3 text-slate-700">{Number(item.hours || 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-slate-900">{formatCurrency(item.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

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
