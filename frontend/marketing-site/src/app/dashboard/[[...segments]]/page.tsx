import { redirect } from 'next/navigation';

const baseDashboardUrl = (process.env.NEXT_PUBLIC_DASHBOARD_BASE_URL || 'https://app.waraqa.com').replace(/\/$/, '');

type Props = {
  params: Promise<{
    segments?: string[];
  }>;
};

const DashboardRedirectPage = async ({ params }: Props) => {
  const { segments } = await params;
  const hasSegments = Array.isArray(segments) && segments.length > 0;
  const pathSuffix = hasSegments ? `/${segments.join('/')}` : '/login';
  const targetUrl = `${baseDashboardUrl}${pathSuffix}`;
  redirect(targetUrl);
  return null;
};

export default DashboardRedirectPage;
