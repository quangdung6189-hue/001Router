import { useMemo, useState } from 'react';
import { Lock, Plus, Search, ShieldAlert, X } from 'lucide-react';
import { Switch } from './Switch';
import { ModalDialog } from './ModalDialog';

/**
 * Per-API-key model/combo access restriction control (9Router Endpoint parity).
 * When `restricted` is enabled, the key may only call models/combos in `allow`.
 */
export function KeyAccessControls({ apiKey, combos = [], providers = [], onChange }) {
  const access = apiKey?.access || { restricted: false, allow: [] };
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allOptions = useMemo(() => {
    const items = [];
    for (const c of combos) {
      if (c.enabled === false || !c.name) continue;
      items.push({ value: c.name, group: 'Combos', badge: 'Combo' });
    }
    for (const p of providers) {
      if (p.enabled === false) continue;
      for (const m of p.models || []) {
        items.push({ value: `${p.slug}/${m}`, group: p.name || p.slug, badge: p.slug });
      }
    }
    return items;
  }, [combos, providers]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allOptions.slice(0, 120);
    return allOptions
      .filter((o) => o.value.toLowerCase().includes(q) || o.group.toLowerCase().includes(q))
      .slice(0, 120);
  }, [allOptions, search]);

  const allowSet = useMemo(
    () => new Set((access.allow || []).map((x) => x.toLowerCase())),
    [access.allow]
  );

  const toggleItem = (val) => {
    const exists = allowSet.has(val.toLowerCase());
    const nextAllow = exists
      ? (access.allow || []).filter((x) => x.toLowerCase() !== val.toLowerCase())
      : [...(access.allow || []), val];
    onChange({ restricted: true, allow: nextAllow });
  };

  return (
    <div className="mt-2.5 border-t border-[var(--border-subtle)] pt-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 text-xs">
          <Lock className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
          <span className="font-medium text-[var(--text-secondary)]">Restrict access</span>
          <Switch
            size="sm"
            checked={Boolean(access.restricted)}
            onChange={(checked) => onChange({ restricted: checked, allow: access.allow || [] })}
            aria-label={`Restrict model access for ${apiKey.name}`}
          />
        </div>
        {access.restricted ? (
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setPickerOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-[#E56A4A]/50 bg-[#E56A4A]/8 px-2 py-0.5 text-[11px] font-medium text-[#E56A4A] hover:bg-[#E56A4A]/15"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
            Add combo or model
          </button>
        ) : null}
      </div>

      {access.restricted ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {(access.allow || []).length === 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-amber-500">
              <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              No combos or models allowed — this key returns 403 for all calls.
            </span>
          ) : (
            (access.allow || []).map((entry) => (
              <span
                key={entry}
                className="inline-flex items-center gap-1 rounded-full border border-[#E56A4A]/35 bg-[#E56A4A]/10 px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
              >
                {entry}
                <button
                  type="button"
                  onClick={() => toggleItem(entry)}
                  aria-label={`Remove ${entry}`}
                  className="rounded text-[var(--text-muted)] hover:text-red-500"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))
          )}
        </div>
      ) : null}

      <ModalDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`Allowed models for "${apiKey?.name || 'Key'}"`}
        subtitle="Select combos or provider/model IDs this Router API Key is authorized to call."
      >
        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search combos or provider/model..."
              className="field-input w-full py-2 pr-3 pl-8 text-xs"
            />
          </div>

          <div className="max-h-72 space-y-1 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-2">
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--text-muted)]">
                No matching combos or models. Connect a provider first.
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const selected = allowSet.has(opt.value.toLowerCase());
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleItem(opt.value)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-xs transition-colors ${
                      selected
                        ? 'bg-[#E56A4A]/15 font-semibold text-[#E56A4A]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
                    }`}
                  >
                    <span className="truncate font-mono">{opt.value}</span>
                    <span className="shrink-0 rounded bg-[var(--bg-card)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
                      {selected ? 'Allowed ✓' : opt.badge}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </ModalDialog>
    </div>
  );
}
