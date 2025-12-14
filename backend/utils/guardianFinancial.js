const DEFAULT_TRANSFER_FEE_MODE = 'fixed';

const normalizeMode = (mode) => {
  if (typeof mode !== 'string') return DEFAULT_TRANSFER_FEE_MODE;
  const normalized = mode.trim();
  return ['fixed', 'percent'].includes(normalized) ? normalized : DEFAULT_TRANSFER_FEE_MODE;
};

const normalizeNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const buildGuardianFinancialSnapshot = (guardianDoc) => {
  const guardianInfo = guardianDoc?.guardianInfo || {};
  const hourlyRate = normalizeNumber(guardianInfo.hourlyRate, 0);

  const transferFeeConfig = guardianInfo.transferFee || {};
  const mode = normalizeMode(transferFeeConfig.mode);
  const value = normalizeNumber(transferFeeConfig.value, 0);

  return {
    hourlyRate,
    transferFee: {
      mode,
      value,
      amount: 0,
      waived: false,
      waivedByCoverage: false,
      source: 'guardian_default',
      notes: transferFeeConfig.notes || undefined
    }
  };
};

module.exports = {
  buildGuardianFinancialSnapshot
};
