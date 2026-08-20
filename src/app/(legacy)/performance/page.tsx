import { PerformanceDashboardProvider } from '@/hooks/use-performance-dashboard';
import { PerformanceDashboardShell } from '@/components/performance/performance-dashboard-shell';

export const metadata = {
  title: 'Performance Dashboard',
  description: 'Analytical performance dashboard with configurable KPIs and charts',
};

export default function PerformancePage() {
  return (
    <PerformanceDashboardProvider>
      <PerformanceDashboardShell />
    </PerformanceDashboardProvider>
  );
}
