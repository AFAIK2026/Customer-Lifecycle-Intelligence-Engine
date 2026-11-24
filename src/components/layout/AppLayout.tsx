import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { ShieldCheck, X } from "lucide-react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { IdleShield } from "@/components/layout/IdleShield";
import { useAppData } from "@/context/AppDataContext";
import { formatDateTime } from "@/lib/utils";

export function AppLayout() {
  const { pathname } = useLocation();
  const { retention, dismissPurgeNotice } = useAppData();

  // Each page starts at the top, e.g. opening a client from far down the dashboard.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <AppSidebar />
      <main className="ml-60 min-h-screen px-8 py-8">
        <div className="mx-auto max-w-7xl">
          {retention.purged_at && (
            <div role="status" className="mb-6 flex items-start gap-3 rounded-md border border-warning/30 bg-warning/[0.06] px-4 py-3 text-sm">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <p className="flex-1">
                For security, CLIE cleared its data on this computer on {formatDateTime(retention.purged_at)} because
                it wasn't used for {retention.retention_days} days.{" "}
                <Link to="/upload" className="text-primary hover:underline">
                  Upload your reports again
                </Link>{" "}
                to continue.
              </p>
              <button type="button" onClick={dismissPurgeNotice} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
          )}
          <Outlet />
        </div>
      </main>
      <IdleShield />
    </div>
  );
}
