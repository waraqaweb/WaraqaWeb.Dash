import type { Metadata } from 'next';
import './globals.css';
import GlobalEvaluationCta from '../components/GlobalEvaluationCta';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Waraqa',
  description: 'Personalized Quran, Arabic, and Islamic studies from anywhere.'
};

const RootLayout = ({ children }: { children: React.ReactNode }) => (
  <html lang="en">
    <body suppressHydrationWarning className="bg-slate-50 text-slate-900 antialiased">
      {children}
      <GlobalEvaluationCta />
    </body>
  </html>
);

export default RootLayout;
