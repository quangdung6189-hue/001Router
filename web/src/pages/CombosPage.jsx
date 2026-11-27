import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckSquare,
  Eye,
  GripVertical,
  Layers,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Save,
  Search,
  Shuffle,
  Sparkles,
  Square,
  Tag,
  Trash2,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import {
  aliasesApi,
  combosApi,
  FALLBACK_PRESETS,
  providersApi,
  settingsApi,
} from '../lib/api';
import { useToast } from '../context/ToastContext';
import { useLocale } from '../context/LocaleContext';
import { Switch } from '../components/Switch';
import { CopyButton } from '../components/CopyButton';
import { ModalDialog } from '../components/ModalDialog';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ProviderLogo } from '../components/ProviderLogo';

const DEFAULT_TEMPLATES = [
  {
    id: '3-tier',
    name: '3-Tier Auto Fallback (Premium → Cheap → Free)',
    defaultComboName: '3-tier-auto',
    badge: 'Recommended',
    description:
      'Routes through Flagship Official APIs first, falls back to Cheap Coding APIs ($0.20–$0.60/1M), then Free Forever / Local LLMs on 429 or quota exhaustion.',
    tiers: [
      {
        tier: 'premium',
        label: 'Tier 1: Flagship',
        candidates: [
          'anthropic/claude-sonnet-4-20250514',
          'openai/gpt-4.1',
          'xai/grok-3',
          'together/meta-llama/Llama-3.3-70B-Instruct-Turbo',
        ],
      },
      {
        tier: 'cheap',
        label: 'Tier 2: Cheap Coding',
        candidates: [
          'deepseek/deepseek-chat',
          'glm/glm-4-plus',
          'minimax/MiniMax-M1',
          'kimi/kimi-k2',
          'alibaba/qwen-coder-plus',
        ],
      },
      {
        tier: 'free',
        label: 'Tier 3: Free Forever',
        candidates: [
          'gemini/gemini-2.5-flash',
          'groq/llama-3.3-70b-versatile',
          'cerebras/llama-3.3-70b',
          'openrouter/deepseek/deepseek-chat-v3-0324:free',
          'ollama/qwen2.5-coder:14b',
        ],
      },
    ],
  },
  {
    id: 'free-only',
    name: 'Free Coding Stack ($0 / month)',
    defaultComboName: 'free-coder',
    badge: '100% Free',
    description:
      'Chains top Free-Tier official developer APIs (Gemini 2.5 Flash → Groq Llama 3.3 → Cerebras → OpenRouter Free → Local Ollama).',
    tiers: [
      {
        tier: 'free',
        label: 'Free Official APIs',
        candidates: [
          'gemini/gemini-2.5-flash',
          'groq/llama-3.3-70b-versatile',
          'cerebras/llama-3.3-70b',
          'openrouter/deepseek/deepseek-chat-v3-0324:free',
          'nvidia/qwen/qwen2.5-coder-32b-instruct',
          'mistral/codestral-latest',
          'ollama/qwen2.5-coder:14b',
        ],
      },
    ],
  },
  {
    id: 'fast-coding',
    name: 'Ultra-Fast Coding & Low Latency',
    defaultComboName: 'fast-coder',
    badge: '2000+ tok/s',
    description:
      'Prioritizes ultra-high-throughput wafer-scale & LPU inference (Cerebras → Groq → SambaNova → Gemini Flash → DeepSeek).',
    tiers: [
      {
        tier: 'free',
        label: 'High-Speed Inference',
        candidates: [
          'cerebras/llama-3.3-70b',
          'groq/llama-3.3-70b-versatile',
          'sambanova/Qwen2.5-Coder-32B-Instruct',
          'gemini/gemini-2.5-flash',
          'deepseek/deepseek-chat',
        ],
      },
    ],
  },
];

const EMPTY_ADAPTER = {
  vision: { enabled: false, roundRobin: false, models: [] },
  audioInput: { enabled: false, roundRobin: false, models: [] },
};

export function CombosPage() {
  const toast = useToast();
  const { t } = useLocale();
  const outletCtx = useOutletContext() || {};
  const headerSearch = outletCtx.headerSearch || '';
  const setHeaderSearch = outletCtx.setHeaderSearch;

  const [combos, setCombos] = useState([]);
  const [providers, setProviders] = useState([]);
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [aliases, setAliases] = useState({});
  const [capacityAdapter, setCapacityAdapter] = useState(EMPTY_ADAPTER);
  const [loading, setLoading] = useState(true);
  const [localSearch, setLocalSearch] = useState('');

  // Bulk select & Drag-and-drop
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [dragId, setDragId] = useState(null);

  // Capacity Adapter inputs
  const [visionInput, setVisionInput] = useState('');
  const [audioInputModel, setAudioInputModel] = useState('');
  const [savingAdapter, setSavingAdapter] = useState(false);

  // Model Alias creator
  const [newAliasName, setNewAliasName] = useState('');
  const [newAliasTarget, setNewAliasTarget] = useState('');

  // Create/Edit Combo modal
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [manualTarget, setManualTarget] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [generatingTemplateId, setGeneratingTemplateId] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [combosRes, providersRes, tplRes, aliasRes, setRes] = await Promise.all([
        combosApi.list(),
        providersApi.list(),
        combosApi.templates().catch(() => null),
        aliasesApi.list().catch(() => ({ aliases: {} })),
        settingsApi.get().catch(() => ({ settings: {} })),
      ]);
      const loadedCombos = combosRes?.combos || [];
      setCombos(loadedCombos);
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const valid = new Set(loadedCombos.map((c) => c.id));
        const next = new Set([...prev].filter((id) => valid.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setProviders(providersRes?.providers || []);
      setAliases(aliasRes?.aliases || {});
      const ca = setRes?.settings?.capacityAdapter;
      if (ca && typeof ca === 'object') {
        setCapacityAdapter({
          vision: {
            enabled: Boolean(ca.vision?.enabled),
            roundRobin: Boolean(ca.vision?.roundRobin),
            models: Array.isArray(ca.vision?.models) ? ca.vision.models : [],
          },
          audioInput: {
            enabled: Boolean(ca.audioInput?.enabled),
            roundRobin: Boolean(ca.audioInput?.roundRobin),
            models: Array.isArray(ca.audioInput?.models) ? ca.audioInput.models : [],
          },
        });
      }
      if (Array.isArray(tplRes?.templates) && tplRes.templates.length > 0) {
        const merged = DEFAULT_TEMPLATES.map((def) => {
          const found = tplRes.templates.find((x) => x.id === def.id);
          return found ? { ...def, ...found } : def;
        });
        for (const extra of tplRes.templates) {
          if (!merged.some((m) => m.id === extra.id)) {
            merged.push(extra);
          }
        }
        setTemplates(merged);
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to load combos');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const modelGroups = useMemo(() => {
    return providers
      .filter((p) => (p.models || []).length > 0)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        enabled: p.enabled !== false,
        options: (p.models || []).map((m) => `${p.slug}/${m}`),
      }));
  }, [providers]);

  const allModelOptions = useMemo(
    () => modelGroups.flatMap((g) => g.options),
    [modelGroups]
  );

  const providerBySlug = useMemo(() => {
    const map = new Map();
    for (const fb of FALLBACK_PRESETS) {
      map.set(fb.preset, fb);
    }
    for (const p of providers) {
      const fb = map.get(p.preset) || {};
      map.set(p.slug, {
        ...fb,
        ...p,
        preset: p.preset || p.slug,
        logo: p.logo || fb.logo || p.preset || p.slug,
        color: p.color || fb.color || '#E56A4A',
      });
    }
    return map;
  }, [providers]);

  const allProviderSlugs = useMemo(() => new Set(providers.map((p) => p.slug)), [providers]);

  const search = setHeaderSearch ? headerSearch : localSearch;
  const setSearch = setHeaderSearch || setLocalSearch;
  const effectiveSearch = search.trim().toLowerCase();
  const filteredCombos = useMemo(() => {
    if (!effectiveSearch) return combos;
    return combos.filter((c) =>
      [c.name, c.description, c.strategy, ...(c.targets || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(effectiveSearch)
    );
  }, [combos, effectiveSearch]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkDeleting(true);
    try {
      await combosApi.bulkDelete(ids);
      setCombos((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      toast.success(`Deleted ${ids.length} combo(s)`);
    } catch (err) {
      toast.error(err?.message || 'Bulk delete failed');
    } finally {
      setBulkDeleting(false);
    }
  };

  const persistReorder = async (nextList) => {
    const prev = combos;
    setCombos(nextList);
    try {
      const res = await combosApi.reorder(nextList.map((c) => c.id));
      if (Array.isArray(res?.combos)) setCombos(res.combos);
    } catch (err) {
      setCombos(prev);
      toast.error(err?.message || 'Failed to reorder combos');
    }
  };

  const moveCombo = (comboId, delta) => {
    const idx = combos.findIndex((c) => c.id === comboId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= combos.length) return;
    const copy = [...combos];
    const [moved] = copy.splice(idx, 1);
    copy.splice(nextIdx, 0, moved);
    persistReorder(copy);
  };

  const handleDropOnCombo = (targetId) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const fromIdx = combos.findIndex((c) => c.id === dragId);
    const toIdx = combos.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) {
      setDragId(null);
      return;
    }
    const copy = [...combos];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    setDragId(null);
    persistReorder(copy);
  };

  const saveCapacityAdapter = async (nextAdapter, msg = 'Capacity Adapter saved') => {
    const prevAdapter = capacityAdapter;
    setCapacityAdapter(nextAdapter);
    setSavingAdapter(true);
    try {
      await settingsApi.update({ capacityAdapter: nextAdapter });
      toast.success(msg);
    } catch (err) {
      setCapacityAdapter(prevAdapter);
      toast.error(err?.message || 'Failed to save Capacity Adapter');
    } finally {
      setSavingAdapter(false);
    }
  };

  const addAdapterModel = (capKey, val) => {
    const cleaned = val.trim();
    if (!cleaned) return;
    const cur = capacityAdapter[capKey]?.models || [];
    if (cur.includes(cleaned)) return;
    const next = {
      ...capacityAdapter,
      [capKey]: { ...capacityAdapter[capKey], models: [...cur, cleaned] },
    };
    saveCapacityAdapter(next, `Added "${cleaned}" to ${capKey} adapter`);
  };

  const removeAdapterModel = (capKey, val) => {
    const cur = capacityAdapter[capKey]?.models || [];
    const next = {
      ...capacityAdapter,
      [capKey]: { ...capacityAdapter[capKey], models: cur.filter((x) => x !== val) },
    };
    saveCapacityAdapter(next, `Removed "${val}" from ${capKey} adapter`);
  };

  const handleAddAlias = async (e) => {
    e.preventDefault();
    const alias = newAliasName.trim();
    const target = newAliasTarget.trim();
    if (!alias || !target) return;
    try {
      const res = await aliasesApi.set(alias, target);
      if (res?.aliases) setAliases(res.aliases);
      setNewAliasName('');
      setNewAliasTarget('');
      toast.success(`Alias "${alias}" → ${target}`);
    } catch (err) {
      toast.error(err?.message || 'Failed to add model alias');
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await aliasesApi.remove(alias);
      if (res?.aliases) setAliases(res.aliases);
      toast.success(`Deleted alias "${alias}"`);
    } catch (err) {
      toast.error(err?.message || 'Failed to remove alias');
    }
  };

  const openCreateModal = () => {
    const firstOpt = modelGroups[0]?.options?.[0] || '';
    setForm({
      id: null,
      name: '',
      description: '',
      strategy: 'fallback',
      enabled: true,
      targets: [],
    });
    setSelectedModel(firstOpt);
    setManualTarget('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (combo) => {
    const firstOpt = modelGroups[0]?.options?.[0] || '';
    setForm({
      id: combo.id,
      name: combo.name || '',
      description: combo.description || '',
      strategy: combo.strategy === 'round-robin' ? 'round-robin' : 'fallback',
      enabled: combo.enabled !== false,
      targets: Array.isArray(combo.targets) ? [...combo.targets] : [],
    });
    setSelectedModel(firstOpt);
    setManualTarget('');
    setFormError('');
    setModalOpen(true);
  };

  const handleGenerateFromTemplate = async (tpl) => {
    setGeneratingTemplateId(tpl.id);
    try {
      const existingNames = new Set(combos.map((c) => c.name));
      const baseName = tpl.defaultComboName || tpl.id;
      let candidateName = baseName;
      let idx = 2;
      while (existingNames.has(candidateName)) {
        candidateName = `${baseName}-${idx++}`;
      }

      try {
        const res = await combosApi.generateTemplate(tpl.id, { name: candidateName });
        if (res?.combo) {
          setCombos((prev) => [...prev, res.combo]);
          toast.success(
            `Generated "${res.combo.name}" (${res.combo.targets?.length || 0} targets)`
          );
          return;
        }
      } catch (apiErr) {
        const enabledProvs = providers.filter(
          (p) => p.enabled !== false && (p.models || []).length > 0
        );
        const connectedBySlug = new Map(enabledProvs.map((p) => [p.slug, p]));
        const connectedByPreset = new Map(enabledProvs.map((p) => [p.preset, p]));
        const matchedTargets = [];
        for (const tierGroup of tpl.tiers || []) {
          for (const cand of tierGroup.candidates || []) {
            const slash = cand.indexOf('/');
            const prefix = slash > -1 ? cand.slice(0, slash) : '';
            const modelRest = slash > -1 ? cand.slice(slash + 1) : cand;
            const prov = connectedBySlug.get(prefix) || connectedByPreset.get(prefix);
            if (prov) {
              const targetModel = prov.models?.includes(modelRest)
                ? modelRest
                : prov.models?.[0] || modelRest;
              const full = `${prov.slug}/${targetModel}`;
              if (!matchedTargets.includes(full)) matchedTargets.push(full);
            }
          }
        }
        const finalTargets =
          matchedTargets.length > 0
            ? matchedTargets
            : enabledProvs.length > 0
              ? enabledProvs.slice(0, 5).map((p) => `${p.slug}/${p.models[0]}`)
              : (tpl.tiers || []).flatMap((t) => t.candidates || []).slice(0, 4);
        if (finalTargets.length === 0) throw apiErr;
        const createdRes = await combosApi.create({
          name: candidateName,
          description: tpl.description || `${tpl.name} auto-generated pipeline`,
          strategy: 'fallback',
          targets: finalTargets,
          enabled: true,
        });
        if (createdRes?.combo) {
          setCombos((prev) => [...prev, createdRes.combo]);
          toast.success(
            `Created "${createdRes.combo.name}" with ${finalTargets.length} fallback targets`
          );
        }
      }
    } catch (err) {
      toast.error(err?.message || 'Failed to generate combo from template');
    } finally {
      setGeneratingTemplateId(null);
    }
  };

  const addTarget = (targetStr) => {
    const cleaned = targetStr.trim();
    if (!cleaned) return;
    if (!cleaned.includes('/')) {
      setFormError(
        'Target must follow "<providerSlug>/<modelId>" syntax (e.g. gemini/gemini-2.5-flash).'
      );
      return;
    }
    setFormError('');
    setForm((prev) => {
      if (!prev) return prev;
      if (prev.targets.includes(cleaned)) {
        setFormError(`"${cleaned}" is already in this pipeline.`);
        return prev;
      }
      return { ...prev, targets: [...prev.targets, cleaned] };
    });
  };

  const moveTarget = (index, delta) => {
    setForm((prev) => {
      if (!prev) return prev;
      const nextIdx = index + delta;
      if (nextIdx < 0 || nextIdx >= prev.targets.length) return prev;
      const next = [...prev.targets];
      const [item] = next.splice(index, 1);
      next.splice(nextIdx, 0, item);
      return { ...prev, targets: next };
    });
  };

  const removeTarget = (index) => {
    setForm((prev) => {
      if (!prev) return prev;
      return { ...prev, targets: prev.targets.filter((_, i) => i !== index) };
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form) return;
    const name = form.name.trim();
    if (!name) {
      setFormError('Combo alias name is required.');
      return;
    }
    if (form.targets.length === 0) {
      setFormError('Add at least one provider/model target.');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      const payload = {
        name,
        description: form.description.trim(),
        strategy: form.strategy,
        targets: form.targets,
        enabled: form.enabled,
      };
      if (form.id) {
        const res = await combosApi.update(form.id, payload);
        if (res?.combo) {
          setCombos((prev) => prev.map((c) => (c.id === res.combo.id ? res.combo : c)));
        }
        toast.success(`Updated combo "${name}"`);
      } else {
        const res = await combosApi.create(payload);
        if (res?.combo) {
          setCombos((prev) => [...prev, res.combo]);
        }
        toast.success(`Created combo "${name}"`);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err?.message || 'Failed to save combo');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (combo, nextEnabled) => {
    setCombos((prev) =>
      prev.map((c) => (c.id === combo.id ? { ...c, enabled: nextEnabled } : c))
    );
    try {
      const res = await combosApi.update(combo.id, { enabled: nextEnabled });
      if (res?.combo) {
        setCombos((prev) => prev.map((c) => (c.id === combo.id ? res.combo : c)));
      }
      toast.success(
        `Combo "${combo.name}" ${nextEnabled ? t('common.enabled') : t('common.disabled')}`
      );
    } catch (err) {
      setCombos((prev) =>
        prev.map((c) => (c.id === combo.id ? { ...c, enabled: combo.enabled } : c))
      );
      toast.error(err?.message || 'Failed to update combo');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await combosApi.remove(deleteTarget.id);
      setCombos((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setSelectedIds((prev) => {
        if (!prev.has(deleteTarget.id)) return prev;
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      toast.success(`Deleted combo "${deleteTarget.name}"`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err?.message || 'Failed to delete combo');
    } finally {
      setDeleting(false);
    }
  };

  const aliasEntries = Object.entries(aliases || {});

  return (
    <div className="space-y-6">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative md:hidden">
            <Search
              className="pointer-events-none absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('combos.searchPlaceholder')}
              className="field-input w-56 py-1.5 pr-3 pl-8 text-xs"
            />
          </div>

          {selectedIds.size > 0 ? (
            <button
              type="button"
              onClick={() => setBulkDeleteOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/12 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-500/20"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Delete Selected ({selectedIds.size})
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`}
              aria-hidden="true"
            />
            {t('common.refresh')}
          </button>

          <button
            type="button"
            onClick={openCreateModal}
            className="r-btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('combos.newCombo')}
          </button>
        </div>
      </div>

      {/* Smart Fallback Presets */}
      <section className="r-card space-y-3.5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Smart Fallback Presets
            </h2>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            Drag combo cards to reorder priority
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {templates.map((tpl) => {
            const isBusy = generatingTemplateId === tpl.id;
            const previewCandidates = (tpl.tiers || [])
              .flatMap((tier) => tier.candidates || [])
              .slice(0, 4);

            return (
              <div
                key={tpl.id}
                className="r-card-subtle flex flex-col justify-between p-4 transition-colors hover:border-[#E56A4A]/50"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-xs font-semibold text-[var(--text-primary)]">
                      {tpl.name}
                    </h3>
                    {tpl.badge ? (
                      <span className="shrink-0 rounded-full bg-[#E56A4A]/15 px-2 py-0.5 text-[10px] font-semibold text-[#E56A4A]">
                        {tpl.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-secondary)]">
                    {tpl.description}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {previewCandidates.map((cand, idx) => {
                      const slug = cand.split('/')[0];
                      const meta = providerBySlug.get(slug);
                      return (
                        <div key={cand} className="inline-flex items-center gap-1">
                          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-1.5 py-0.5 text-[10px]">
                            <ProviderLogo
                              preset={slug}
                              logo={meta?.logo}
                              name={meta?.name || slug}
                              color={meta?.color}
                              size={16}
                            />
                            <code className="font-mono text-[10px] text-[var(--text-primary)]">
                              {slug}
                            </code>
                          </span>
                          {idx < previewCandidates.length - 1 ? (
                            <ArrowRight
                              className="h-2.5 w-2.5 text-[var(--text-muted)]"
                              aria-hidden="true"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3.5 pt-2">
                  <button
                    type="button"
                    disabled={Boolean(generatingTemplateId)}
                    onClick={() => handleGenerateFromTemplate(tpl)}
                    className="r-btn-secondary flex w-full items-center justify-center gap-1.5 px-3 py-1.5 text-xs hover:border-[#E56A4A] hover:text-[#E56A4A]"
                  >
                    <Zap className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                    {isBusy ? 'Generating Combo…' : `Generate "${tpl.defaultComboName || tpl.id}"`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Combos List (Drag-and-Drop + Bulk Select) */}
      {filteredCombos.length === 0 && !loading ? (
        <div className="r-card border-dashed p-10 text-center">
          <Layers className="mx-auto h-9 w-9 text-[var(--text-muted)]" aria-hidden="true" />
          <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)]">
            {t('combos.emptyTitle')}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--text-secondary)]">
            {t('combos.emptyDesc')}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            <button
              type="button"
              onClick={openCreateModal}
              className="r-btn-primary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('combos.newCombo')}
            </button>
            <button
              type="button"
              onClick={() => handleGenerateFromTemplate(templates[0])}
              disabled={Boolean(generatingTemplateId)}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-xs"
            >
              <Sparkles className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
              Generate 3-Tier Auto Fallback
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredCombos.map((combo, cIdx) => {
            const isRR = combo.strategy === 'round-robin';
            const isSelected = selectedIds.has(combo.id);

            return (
              <article
                key={combo.id}
                draggable={!effectiveSearch}
                onDragStart={() => setDragId(combo.id)}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDropOnCombo(combo.id)}
                className={`r-card flex flex-col justify-between p-5 transition-colors ${
                  isSelected ? 'border-[#E56A4A]' : ''
                } ${dragId === combo.id ? 'opacity-60' : ''}`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <button
                        type="button"
                        onClick={() => toggleSelect(combo.id)}
                        aria-label={`Select combo ${combo.name}`}
                        className="mt-0.5 text-[var(--text-muted)] hover:text-[#E56A4A]"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
                        ) : (
                          <Square className="h-4 w-4" aria-hidden="true" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <GripVertical
                            className="h-3.5 w-3.5 cursor-grab text-[var(--text-muted)]"
                            aria-hidden="true"
                          />
                          <code className="rounded-lg border border-[#E56A4A]/35 bg-[#E56A4A]/12 px-2.5 py-0.5 text-sm font-semibold text-[#E56A4A]">
                            {combo.name}
                          </code>
                          <CopyButton
                            value={combo.name}
                            size="xs"
                            iconOnly
                            label={`Copy ${combo.name}`}
                            toastMessage={`Copied "${combo.name}"`}
                          />
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              isRR
                                ? 'border-sky-500/35 bg-sky-500/12 text-sky-400'
                                : 'border-emerald-500/35 bg-emerald-500/12 text-emerald-400'
                            }`}
                          >
                            {isRR ? (
                              <Shuffle className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <Repeat className="h-3 w-3" aria-hidden="true" />
                            )}
                            {isRR ? t('combos.strategyRoundRobin') : t('combos.strategyFallback')}
                          </span>
                        </div>
                        {combo.description ? (
                          <p className="mt-2 text-xs text-[var(--text-secondary)]">
                            {combo.description}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <Switch
                      size="sm"
                      checked={combo.enabled !== false}
                      onChange={(val) => handleToggleEnabled(combo, val)}
                      aria-label={`Toggle combo ${combo.name}`}
                    />
                  </div>

                  {/* Visual Numbered Target Pipeline */}
                  <div className="mt-4 space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      Pipeline ({combo.targets?.length || 0})
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(combo.targets || []).map((target, idx) => {
                        const slashIdx = target.indexOf('/');
                        const targetSlug = slashIdx > -1 ? target.slice(0, slashIdx) : '';
                        const knownSlug = allProviderSlugs.has(targetSlug);
                        const provMeta = providerBySlug.get(targetSlug);

                        return (
                          <div
                            key={`${target}-${idx}`}
                            className="flex max-w-full items-center gap-1.5"
                          >
                            <div
                              className={`flex max-w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                                knownSlug
                                  ? 'border-[var(--border-subtle)] bg-[var(--bg-subtle)]'
                                  : 'border-amber-500/40 bg-amber-500/10'
                              }`}
                            >
                              <span
                                className={`shrink-0 rounded px-1.5 py-0.2 font-mono text-[10px] font-bold ${
                                  idx === 0
                                    ? 'bg-[#E56A4A] text-white'
                                    : 'bg-[var(--bg-card)] text-[var(--text-secondary)]'
                                }`}
                              >
                                #{idx + 1}
                              </span>
                              <ProviderLogo
                                preset={provMeta?.preset || targetSlug}
                                logo={provMeta?.logo}
                                logoExt={provMeta?.logoExt}
                                name={provMeta?.name || targetSlug}
                                color={provMeta?.color}
                                monogram={provMeta?.monogram}
                                size="xs"
                              />
                              <code className="single-line-truncate text-[11px] text-[var(--text-primary)]">
                                {target}
                              </code>
                            </div>
                            {idx < (combo.targets?.length || 0) - 1 ? (
                              <ArrowRight
                                className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
                                aria-hidden="true"
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
                  <div className="flex items-center gap-1">
                    {!effectiveSearch ? (
                      <>
                        <button
                          type="button"
                          disabled={cIdx === 0}
                          onClick={() => moveCombo(combo.id, -1)}
                          aria-label={`Move ${combo.name} up`}
                          className="r-btn-secondary p-1"
                        >
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          disabled={cIdx === combos.length - 1}
                          onClick={() => moveCombo(combo.id, 1)}
                          aria-label={`Move ${combo.name} down`}
                          className="r-btn-secondary p-1"
                        >
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(combo)}
                      className="r-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('common.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(combo)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('common.delete')}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 9Router Capacity Adapter: Vision & Audio Auto-Adapter */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-violet-400" aria-hidden="true" />
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Capacity Adapter — Vision &amp; Audio Auto-Routing
              </h2>
              <span className="rounded-full border border-violet-500/35 bg-violet-500/12 px-2 py-0.5 text-[10px] font-semibold text-violet-400">
                9Router Auto-Adapter
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              When a request containing images or audio targets a text-only model, 001Router
              automatically re-routes it to your configured Vision or Audio adapter pool.
            </p>
          </div>
          {savingAdapter ? (
            <span className="text-xs text-[var(--text-muted)]">Saving…</span>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Vision Adapter */}
          <div className="r-card-subtle space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-violet-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Vision Adapter (Image Inputs)
                </span>
              </div>
              <Switch
                checked={capacityAdapter.vision.enabled}
                onChange={(v) =>
                  saveCapacityAdapter(
                    {
                      ...capacityAdapter,
                      vision: { ...capacityAdapter.vision, enabled: v },
                    },
                    `Vision Adapter ${v ? 'enabled' : 'disabled'}`
                  )
                }
                aria-label="Enable Vision Capacity Adapter"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>Round-Robin across Vision fallback models</span>
              <Switch
                size="sm"
                checked={capacityAdapter.vision.roundRobin}
                onChange={(v) =>
                  saveCapacityAdapter({
                    ...capacityAdapter,
                    vision: { ...capacityAdapter.vision, roundRobin: v },
                  })
                }
                aria-label="Vision Adapter Round-Robin"
              />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                list="adapter-models-list"
                value={visionInput}
                onChange={(e) => setVisionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAdapterModel('vision', visionInput);
                    setVisionInput('');
                  }
                }}
                placeholder="e.g. gemini/gemini-2.5-flash"
                className="field-input flex-1 px-2.5 py-1.5 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  addAdapterModel('vision', visionInput);
                  setVisionInput('');
                }}
                className="r-btn-primary px-3 py-1.5 text-xs"
              >
                Add
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {capacityAdapter.vision.models.length === 0 ? (
                <span className="text-[11px] text-[var(--text-muted)]">
                  No vision adapter models configured yet.
                </span>
              ) : (
                capacityAdapter.vision.models.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 rounded-full border border-violet-500/35 bg-violet-500/10 px-2.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => removeAdapterModel('vision', m)}
                      aria-label={`Remove ${m}`}
                      className="text-[var(--text-muted)] hover:text-red-500"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Audio Input Adapter */}
          <div className="r-card-subtle space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-sky-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Audio Input Adapter
                </span>
              </div>
              <Switch
                checked={capacityAdapter.audioInput.enabled}
                onChange={(v) =>
                  saveCapacityAdapter(
                    {
                      ...capacityAdapter,
                      audioInput: { ...capacityAdapter.audioInput, enabled: v },
                    },
                    `Audio Adapter ${v ? 'enabled' : 'disabled'}`
                  )
                }
                aria-label="Enable Audio Input Capacity Adapter"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
              <span>Round-Robin across Audio fallback models</span>
              <Switch
                size="sm"
                checked={capacityAdapter.audioInput.roundRobin}
                onChange={(v) =>
                  saveCapacityAdapter({
                    ...capacityAdapter,
                    audioInput: { ...capacityAdapter.audioInput, roundRobin: v },
                  })
                }
                aria-label="Audio Adapter Round-Robin"
              />
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                list="adapter-models-list"
                value={audioInputModel}
                onChange={(e) => setAudioInputModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAdapterModel('audioInput', audioInputModel);
                    setAudioInputModel('');
                  }
                }}
                placeholder="e.g. openai/gpt-4o-audio-preview"
                className="field-input flex-1 px-2.5 py-1.5 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  addAdapterModel('audioInput', audioInputModel);
                  setAudioInputModel('');
                }}
                className="r-btn-primary px-3 py-1.5 text-xs"
              >
                Add
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {capacityAdapter.audioInput.models.length === 0 ? (
                <span className="text-[11px] text-[var(--text-muted)]">
                  No audio adapter models configured yet.
                </span>
              ) : (
                capacityAdapter.audioInput.models.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1 rounded-full border border-sky-500/35 bg-sky-500/10 px-2.5 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
                  >
                    {m}
                    <button
                      type="button"
                      onClick={() => removeAdapterModel('audioInput', m)}
                      aria-label={`Remove ${m}`}
                      className="text-[var(--text-muted)] hover:text-red-500"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        <datalist id="adapter-models-list">
          {allModelOptions.map((opt) => (
            <option key={opt} value={opt} />
          ))}
        </datalist>
      </section>

      {/* Model Aliases Manager */}
      <section className="r-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Model Aliases ({aliasEntries.length})
            </h2>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            Map short client names (e.g. <code>fast</code>, <code>claude-sonnet</code>) to any
            provider/model
          </span>
        </div>

        <form onSubmit={handleAddAlias} className="grid gap-2.5 sm:grid-cols-12">
          <input
            type="text"
            value={newAliasName}
            onChange={(e) => setNewAliasName(e.target.value)}
            placeholder="Alias name (e.g. fast-coder)"
            className="field-input px-3 py-1.5 font-mono text-xs sm:col-span-4"
          />
          <input
            type="text"
            list="adapter-models-list"
            value={newAliasTarget}
            onChange={(e) => setNewAliasTarget(e.target.value)}
            placeholder="Target (e.g. gemini/gemini-2.5-flash)"
            className="field-input px-3 py-1.5 font-mono text-xs sm:col-span-6"
          />
          <button
            type="submit"
            disabled={!newAliasName.trim() || !newAliasTarget.trim()}
            className="r-btn-primary inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs sm:col-span-2"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            Bind Alias
          </button>
        </form>

        {aliasEntries.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {aliasEntries.map(([alias, target]) => (
              <div
                key={alias}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-subtle)] px-3 py-1.5 font-mono text-xs"
              >
                <span className="font-semibold text-[#E56A4A]">{alias}</span>
                <ArrowRight className="h-3 w-3 text-[var(--text-muted)]" aria-hidden="true" />
                <span className="text-[var(--text-primary)]">{target}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteAlias(alias)}
                  aria-label={`Delete alias ${alias}`}
                  className="text-[var(--text-muted)] hover:text-red-500"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">No custom model aliases yet.</p>
        )}
      </section>

      {/* Create / Edit Combo Modal */}
      <ModalDialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form?.id ? `${t('common.edit')} · ${form.name}` : t('combos.newCombo')}
        subtitle="Use this combo name directly as the model ID in Claude Code, Cursor, or Codex CLI."
        size="md"
        lightDismiss={false}
      >
        {form ? (
          <form onSubmit={handleSave} className="space-y-4">
            {formError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="combo-name"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Combo Alias Name
                </label>
                <input
                  id="combo-name"
                  type="text"
                  required
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. 3-tier-auto or free-coder"
                  className="field-input mt-1.5 w-full px-3 py-2 font-mono text-sm"
                />
              </div>

              <div className="flex items-end pb-2">
                <Switch
                  checked={form.enabled}
                  onChange={(val) => setForm((prev) => ({ ...prev, enabled: val }))}
                  label={t('common.enabled')}
                />
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-[var(--text-secondary)]">
                Routing Strategy
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, strategy: 'fallback' }))}
                  className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                    form.strategy === 'fallback'
                      ? 'border-[#E56A4A] bg-[#E56A4A]/12 text-[var(--text-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Repeat className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                    Fallback
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-80">Try #1 → #2 → #3 in order</div>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, strategy: 'round-robin' }))}
                  className={`rounded-lg border px-3 py-2.5 text-left text-xs transition-colors ${
                    form.strategy === 'round-robin'
                      ? 'border-[#E56A4A] bg-[#E56A4A]/12 text-[var(--text-primary)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-subtle)] text-[var(--text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Shuffle className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                    Round Robin
                  </div>
                  <div className="mt-0.5 text-[11px] opacity-80">Rotate starting target per call</div>
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="combo-desc"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Description ({t('common.optional')})
              </label>
              <input
                id="combo-desc"
                type="text"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Tier 1 Flagship → Tier 2 Cheap → Tier 3 Free fallback"
                className="field-input mt-1.5 w-full px-3 py-2 text-sm"
              />
            </div>

            <div className="space-y-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3.5">
              <div className="text-xs font-semibold text-[var(--text-primary)]">Target Models</div>

              {modelGroups.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    aria-label="Select available provider model"
                    className="field-input min-w-0 flex-1 px-3 py-1.5 font-mono text-xs"
                  >
                    {modelGroups.map((grp) => (
                      <optgroup
                        key={grp.slug}
                        label={`${grp.name} (${grp.slug})${grp.enabled ? '' : ' [off]'}`}
                      >
                        {grp.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => addTarget(selectedModel)}
                    className="r-btn-primary px-3 py-1.5 text-xs"
                  >
                    Add
                  </button>
                </div>
              ) : null}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualTarget}
                  onChange={(e) => setManualTarget(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTarget(manualTarget);
                      setManualTarget('');
                    }
                  }}
                  placeholder="Manual: providerSlug/modelId"
                  className="field-input flex-1 px-3 py-1.5 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    addTarget(manualTarget);
                    setManualTarget('');
                  }}
                  className="r-btn-secondary px-3 py-1.5 text-xs"
                >
                  Add Manual
                </button>
              </div>

              {form.targets.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border-strong)] p-4 text-center text-xs text-[var(--text-muted)]">
                  No targets added yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {form.targets.map((target, idx) => {
                    const slug = target.split('/')[0];
                    const meta = providerBySlug.get(slug);
                    return (
                      <li
                        key={`${target}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 rounded bg-[#E56A4A]/15 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#E56A4A]">
                            #{idx + 1}
                          </span>
                          <ProviderLogo
                            preset={meta?.preset || slug}
                            logo={meta?.logo}
                            name={meta?.name || slug}
                            color={meta?.color}
                            size="xs"
                          />
                          <code className="single-line-truncate text-xs text-[var(--text-primary)]">
                            {target}
                          </code>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveTarget(idx, -1)}
                            disabled={idx === 0}
                            aria-label={`Move ${target} up`}
                            className="r-btn-secondary p-1"
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveTarget(idx, 1)}
                            disabled={idx === form.targets.length - 1}
                            aria-label={`Move ${target} down`}
                            className="r-btn-secondary p-1"
                          >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeTarget(idx)}
                            aria-label={`Remove ${target}`}
                            className="rounded-md border border-red-500/30 bg-red-500/10 p-1 text-red-500 hover:bg-red-500/20"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex justify-end gap-2.5 border-t border-[var(--border-subtle)] pt-4">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="r-btn-secondary px-3.5 py-2 text-xs"
              >
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={saving} className="r-btn-primary px-4 py-2 text-xs">
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        ) : null}
      </ModalDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete "${deleteTarget?.name || ''}"?`}
        destructive
        busy={deleting}
        confirmLabel={t('common.delete')}
        message={
          <p>
            Clients requesting <code>{deleteTarget?.name}</code> will no longer resolve to its
            pipeline targets.
          </p>
        }
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedIds.size} Selected Combo(s)?`}
        destructive
        busy={bulkDeleting}
        confirmLabel="Delete Selected"
        message={<p>This permanently deletes the {selectedIds.size} selected combos.</p>}
      />
    </div>
  );
}
