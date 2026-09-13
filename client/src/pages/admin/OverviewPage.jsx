import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import useFetch from '../../hooks/useFetch.js';
import { api } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Badge, PageHeader, StatCard, StatusBadge } from '../../components/ui/display.jsx';
import { ErrorState, LoadingBlock } from '../../components/ui/feedback.jsx';
import { Table } from '../../components/ui/Table.jsx';
import { TrendChart } from '../../components/charts/Charts.jsx';
import { IconCircleCheck } from '../../components/ui/icons.jsx';
import { formatDate, formatShortDate, timeAgo } from '../../utils/format.js';

export default function OverviewPage() {
  const { currentBranchId } = useAuth();
  const { data, loading, error, reload } = useFetch(
    () => api('/reports/dashboard', { params: currentBranchId ? { branchId: currentBranchId } : {} }),
    [currentBranchId]
  );

  useEffect(() => {
    document.title = 'Overview — Church Attendance Tracker';
  }, []);

  if (loading) return <div className="container"><LoadingBlock label="Building your dashboard…" /></div>;
  if (error) return <div className="container"><ErrorState error={error} onRetry={reload} /></div>;

  const d = data || {};
  const latest = d.latestService;