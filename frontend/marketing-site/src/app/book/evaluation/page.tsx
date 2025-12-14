import { redirect } from 'next/navigation';

const baseDashboardUrl = (process.env.NEXT_PUBLIC_DASHBOARD_BASE_URL || 'https://app.waraqa.com').replace(/\/$/, '');

const EvaluationBookingPage = () => {
  redirect(`${baseDashboardUrl}/book/evaluation`);
};

export default EvaluationBookingPage;
