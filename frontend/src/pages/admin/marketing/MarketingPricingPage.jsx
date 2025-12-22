import React, { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCcw } from 'lucide-react';
import { getAdminPricingPlans } from '../../../api/marketing';
import PricingPlanModal from '../../../components/features/marketing/PricingPlanModal';
import { shellCard, shellPad, table, tableWrap, td, th, titleH2, titleKicker, titleP, tr, primaryButton, secondaryButton, pill } from './_shared';

const formatPrice = (plan) => {
  const amount = plan?.price?.amount;
  const currency = plan?.price?.currency;
  const cadence = plan?.price?.cadence;
  if (typeof amount !== 'number' && typeof amount !== 'string') return '—';
  if (!currency) return `${amount}`;
  return `${currency} ${amount}${cadence ? ` / ${cadence}` : ''}`;
};

const MarketingPricingPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [items, setItems] = useState([]);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const plans = await getAdminPricingPlans();
        if (!mounted) return;
        setItems(Array.isArray(plans) ? plans : []);
      } catch (e) {
        if (mounted) setError('Failed to load pricing plans.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const ao = Number(a?.sortOrder ?? 0);
      const bo = Number(b?.sortOrder ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a?.headline || '').localeCompare(String(b?.headline || ''));
    });
    return sorted;
  }, [items]);

  const openNew = () => {
    setSelected(null);
    setOpen(true);
  };

  const openEdit = (plan) => {
    setSelected(plan);
    setOpen(true);
  };

  const handleSaved = (saved) => {
    setItems((prev) => {
      const existing = prev.find((p) => p._id === saved._id);
      if (!existing) return [saved, ...prev];
      return prev.map((p) => (p._id === saved._id ? saved : p));
    });
  };

  const handleDeleted = (id) => {
    setItems((prev) => prev.filter((p) => p._id !== id));
  };

  return (
    <div className="space-y-6">
      <div className={`flex flex-wrap items-start justify-between gap-3 ${shellCard} ${shellPad}`}>
        <div>
          <p className={titleKicker}>Content</p>
          <h2 className={titleH2}>Pricing plans</h2>
          <p className={titleP}>Plan cards and CTAs used on the marketing site.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </button>
          <button type="button" className={primaryButton} onClick={openNew}>
            <Plus className="h-4 w-4" />
            New plan
          </button>
        </div>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className={`${shellCard} ${shellPad}`}>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No pricing plans yet.</p>
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th className={th}>Headline</th>
                  <th className={th}>Key</th>
                  <th className={th}>Price</th>
                  <th className={th}>Highlight</th>
                  <th className={th}>Published</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((plan) => (
                  <tr
                    key={plan._id}
                    className={`${tr} cursor-pointer hover:border-slate-300`}
                    onClick={() => openEdit(plan)}
                  >
                    <td className={td}>
                      <div className="font-semibold text-slate-900">{plan.headline || 'Untitled'}</div>
                      <div className="text-xs text-slate-500">{plan.subheading || '—'}</div>
                    </td>
                    <td className={td}>{plan.key || '—'}</td>
                    <td className={td}>{formatPrice(plan)}</td>
                    <td className={td}>
                      <span className={plan.highlight ? pill('amber') : pill('slate')}>{plan.highlight ? 'Highlight' : '—'}</span>
                    </td>
                    <td className={td}>
                      <span className={plan.published ? pill('green') : pill('slate')}>{plan.published ? 'Live' : 'Hidden'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <PricingPlanModal
        open={open}
        onClose={() => setOpen(false)}
        plan={selected}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        variant="drawer"
      />
    </div>
  );
};

export default MarketingPricingPage;
