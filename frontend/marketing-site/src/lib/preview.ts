import 'server-only';

import { cookies } from 'next/headers';

type PreviewOptions = {
  preview?: boolean;
  token?: string;
};

const PREVIEW_COOKIE = 'waraqa_marketing_preview';
const PREVIEW_TOKEN_COOKIE = 'waraqa_marketing_preview_token';

export const getMarketingPreviewOptions = async (): Promise<PreviewOptions> => {
  const store = await cookies();
  const enabled = store.get(PREVIEW_COOKIE)?.value === '1';
  const token = store.get(PREVIEW_TOKEN_COOKIE)?.value;
  if (!enabled) return {};
  return { preview: true, token };
};

