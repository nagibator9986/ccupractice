import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleCheck, FileText, GraduationCap, RefreshCw, TriangleAlert, UserRoundX } from "lucide-react";
import { contractsApi, errorText } from "../api/endpoints.js";
import { useAuth } from "../context/AuthContext.jsx";
import StatCard from "../components/StatCard.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { CardSkeleton } from "../components/Skeleton.jsx";
import { plural } from "../utils/format.js";
import DashboardHero from "../components/dashboard/DashboardHero.jsx";
import AttentionPanel from "../components/dashboard/AttentionPanel.jsx";
import PipelinePanel from "../components/dashboard/PipelinePanel.jsx";
import GroupsPanel from "../components/dashboard/GroupsPanel.jsx";
import RecentContracts from "../components/dashboard/RecentContracts.jsx";
import QuickActions from "../components/dashboard/QuickActions.jsx";
import GettingStarted from "../components/dashboard/GettingStarted.jsx";
import { buildAttentionGroups, kpisFrom, pickCta, summaryLine } from "../components/dashboard/dashboardLogic.js";

function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Загрузка сводки">
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <StatCard key={i} label="" loading />
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={5} />
        </div>
        <div className="space-y-5">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStats(await contractsApi.stats());
    } catch (e) {
      setStats(null);
      setError(await errorText(e, "Не удалось загрузить сводку"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const k = useMemo(() => kpisFrom(stats), [stats]);
  const cta = useMemo(() => (stats ? pickCta(stats, isAdmin) : null), [stats, isAdmin]);
  const summary = useMemo(() => (stats ? summaryLine(stats) : ""), [stats]);
  const attentionGroups = useMemo(
    () => (stats ? buildAttentionGroups(stats.attention, k.withoutContract) : []),
    [stats, k.withoutContract],
  );

  const showSkeleton = loading && !stats;

  return (
    <div>
      <DashboardHero fullName={user?.full_name} summary={showSkeleton ? "" : summary} cta={cta} />

      {showSkeleton && <DashboardSkeleton />}

      {!showSkeleton && error && (
        <div className="card">
          <EmptyState
            icon={TriangleAlert}
            title="Не удалось загрузить сводку"
            description={error}
            action={
              <button type="button" className="btn-primary" onClick={load} disabled={loading}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Повторить
              </button>
            }
          />
        </div>
      )}

      {stats && (
        <>
          <section className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" aria-label="Ключевые показатели">
            <StatCard
              icon={GraduationCap}
              tone="blue"
              label="Студентов"
              value={k.students}
              hint={k.partners ? `${k.partners} ${plural(k.partners, "предприятие", "предприятия", "предприятий")}` : "предприятий пока нет"}
              to="/students"
            />
            <StatCard
              icon={UserRoundX}
              tone={k.withoutContract > 0 ? "amber" : "emerald"}
              label="Без договора"
              value={k.withoutContract}
              hint={k.withoutContract > 0 ? "нужно оформить" : "у всех есть договор"}
              to="/students?contract=none"
            />
            <StatCard
              icon={FileText}
              tone="indigo"
              label="В работе"
              value={k.inProgress}
              hint="черновики, сформированные и отправленные"
              to="/contracts"
            />
            <StatCard
              icon={CircleCheck}
              tone="emerald"
              label="Подписано"
              value={k.signed}
              hint={k.contracts ? `из ${k.contracts} ${plural(k.contracts, "договора", "договоров", "договоров")}` : "договоров пока нет"}
              to="/contracts"
            />
          </section>

          <div className="grid gap-5 lg:grid-cols-3">
            <div className="min-w-0 space-y-5 lg:col-span-2">
              {k.students === 0 && (
                <GettingStarted partners={k.partners} students={k.students} contracts={k.contracts} isAdmin={isAdmin} />
              )}
              {(attentionGroups.length > 0 || k.students > 0) && <AttentionPanel groups={attentionGroups} />}
              <PipelinePanel byStatus={stats.by_status} byAction={stats.by_next_action} />
              <GroupsPanel groups={stats.groups} isAdmin={isAdmin} />
            </div>
            <div className="min-w-0 space-y-5">
              <QuickActions isAdmin={isAdmin} />
              <RecentContracts items={stats.recent} isAdmin={isAdmin} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
