import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, RefreshCw, ShieldAlert } from 'lucide-react';
import { cliToolsApi } from '../lib/api';
import { CODING_TOOLS, MITM_IDE_CARDS, getToolSummaryStatus } from '../lib/cliToolMeta';
import { ProviderLogo } from '../components/ProviderLogo';

function StatusBadge({ meta }) {
  const cls =
    meta.tone === 'success'
      ? 'bg-emerald-500/15 text-emerald-400'
      : meta.tone === 'warning'
        ? 'bg-amber-500/15 text-amber-400'
        : 'bg-[var(--bg-subtle)] text-[var(--text-muted)]';

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>{meta.label}</span>
  );
}

export function CliToolsPage() {
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);

  const loadStatuses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await cliToolsApi.statuses();
      setStatuses(res?.statuses || {});
    } catch {
      setStatuses({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatuses();
  }, [loadStatuses]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">CLI &amp; IDE Tools</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            Configure coding agents and IDEs in one click, or inspect manual snippets per tool.
          </p>
        </div>

        <button
          type="button"
          onClick={loadStatuses}
          disabled={loading}
          className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {/* MITM / IDE Extension Bridge Section */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
              IDE MITM &amp; Extension Bridge
            </h3>
            <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-400">
              Extension &amp; BYOK
            </span>
          </div>
          <Link to="/mitm" className="text-xs font-semibold text-[#E56A4A] hover:underline">
            Open Bridge Manager -&gt;
          </Link>
        </div>

        <Link
          to="/mitm"
          className="r-card flex items-center justify-between gap-4 border-amber-500/30 bg-amber-500/5 p-4 transition-colors hover:border-[#E56A4A]/60"
        >
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 shrink-0 text-amber-400" aria-hidden="true" />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">
                Route Antigravity, Kiro, Copilot &amp; Cursor via 001Router
              </div>
              <div className="text-xs text-[var(--text-secondary)]">
                Use the ToS-safe 001Router IDE Extension (`POST /api/extension/connect`) or map IDE
                model slots directly without OS hosts/TLS tampering.
              </div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        </Link>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MITM_IDE_CARDS.map((ide) => (
            <Link
              key={ide.id}
              to="/mitm"
              className="r-card flex items-center justify-between gap-3 p-3.5 transition-colors hover:border-[#E56A4A]/60"
            >
              <div className="flex min-w-0 items-center gap-3">
                <ProviderLogo
                  logo={ide.logo}
                  name={ide.name}
                  monogram={ide.monogram}
                  color={ide.color}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                      {ide.name}
                    </span>
                    <span className="rounded-full bg-purple-500/15 px-1.5 py-0.2 text-[10px] font-medium text-purple-400">
                      IDE
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-[var(--text-muted)]">{ide.description}</p>
                </div>
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                aria-hidden="true"
              />
            </Link>
          ))}
        </div>
      </section>

      {/* CLI Tools 4-col grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            CLI &amp; Coding Agents
          </h3>
          <span className="text-xs text-[var(--text-muted)]">{CODING_TOOLS.length} tools</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {CODING_TOOLS.map((tool) => {
            const st = tool.backendId ? statuses[tool.backendId] : null;
            const statusMeta = getToolSummaryStatus(tool, st);

            return (
              <Link
                key={tool.id}
                to={`/cli-tools/${tool.id}`}
                className="r-card flex items-center justify-between gap-3 p-3.5 transition-colors hover:border-[#E56A4A]/60"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ProviderLogo
                    logo={tool.logo}
                    name={tool.name}
                    monogram={tool.monogram}
                    color={tool.color}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {tool.name}
                      </span>
                      <StatusBadge meta={statusMeta} />
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">
                      {st?.summary?.model || tool.tag}
                    </p>
                  </div>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export default CliToolsPage;
