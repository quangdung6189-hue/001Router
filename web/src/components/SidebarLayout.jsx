import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  ChevronDown,
  Cpu,
  DollarSign,
  ExternalLink,
  Film,
  Gauge,
  Globe,
  History,
  Image,
  KeyRound,
  Layers,
  LayoutGrid,
  LogOut,
  Menu,
  Mic,
  Moon,
  Network,
  Scissors,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  Volume2,
  Waypoints,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useLocale } from '../context/LocaleContext';
import { healthApi, settingsApi } from '../lib/api';
import { ChangelogModal } from './ChangelogModal';

const MAIN_NAV = [
  { to: '/', labelKey: 'nav.endpoint', icon: KeyRound, end: true },
  { to: '/providers', labelKey: 'nav.providers', icon: Server },
  { to: '/models', labelKey: 'nav.models', icon: Cpu, badge: '470+' },
  { to: '/combos', labelKey: 'nav.combos', icon: Layers },
  { to: '/usage', labelKey: 'nav.usage', icon: BarChart3 },
  { to: '/quota', labelKey: 'nav.quota', icon: Gauge },
  { to: '/token-saver', labelKey: 'nav.tokenSaver', icon: Scissors },
  { to: '/cli-tools', labelKey: 'nav.cliTools', icon: Terminal },
  { to: '/playground', labelKey: 'nav.playground', icon: Sparkles },
];

const MEDIA_SUB_NAV = [
  { to: '/media-providers/embedding', labelKey: 'nav.media.embedding', icon: Cpu },
  { to: '/media-providers/image', labelKey: 'nav.media.image', icon: Image },
  { to: '/media-providers/video', labelKey: 'nav.media.video', icon: Film },
  { to: '/media-providers/tts', labelKey: 'nav.media.tts', icon: Volume2 },
  { to: '/media-providers/stt', labelKey: 'nav.media.stt', icon: Mic },
  { to: '/media-providers/web', labelKey: 'nav.media.web', icon: Globe },
];

const DEBUG_NAV = [
  { to: '/console-log', labelKey: 'nav.consoleLog', icon: ScrollText },
  { to: '/translator', labelKey: 'nav.translator', icon: ArrowLeftRight, requiresTranslator: true },
];

const SYSTEM_NAV = [
  { to: '/proxy-pools', labelKey: 'nav.proxyPools', icon: Network },
  { to: '/skills', labelKey: 'nav.skills', icon: BookOpen },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

const ROUTE_META = {
  '/': { titleKey: 'page.endpoint.title', subtitleKey: 'page.endpoint.subtitle' },
  '/providers': {
    titleKey: 'page.providers.title',
    subtitleKey: 'page.providers.subtitle',
    searchable: true,
    searchPlaceholderKey: 'providers.searchPlaceholder',
  },
  '/models': {
    titleKey: 'page.models.title',
    subtitleKey: 'page.models.subtitle',
    searchable: true,
    searchPlaceholderKey: 'providers.searchPlaceholder',
  },
  '/combos': {
    titleKey: 'page.combos.title',
    subtitleKey: 'page.combos.subtitle',
    searchable: true,
    searchPlaceholderKey: 'combos.searchPlaceholder',
  },
  '/usage': { titleKey: 'page.usage.title', subtitleKey: 'page.usage.subtitle' },
  '/quota': { titleKey: 'page.quota.title', subtitleKey: 'page.quota.subtitle' },
  '/token-saver': { titleKey: 'page.tokenSaver.title', subtitleKey: 'page.tokenSaver.subtitle' },
  '/cli-tools': { titleKey: 'page.cliTools.title', subtitleKey: 'page.cliTools.subtitle' },
  '/playground': { titleKey: 'page.playground.title', subtitleKey: 'page.playground.subtitle' },
  '/skills': { titleKey: 'page.skills.title', subtitleKey: 'page.skills.subtitle' },
  '/console-log': { titleKey: 'page.consoleLog.title', subtitleKey: 'page.consoleLog.subtitle' },
  '/translator': { titleKey: 'page.translator.title', subtitleKey: 'page.translator.subtitle' },
  '/proxy-pools': { titleKey: 'page.proxyPools.title', subtitleKey: 'page.proxyPools.subtitle' },
  '/settings': { titleKey: 'page.settings.title', subtitleKey: 'page.settings.subtitle' },
  '/settings/pricing': { titleKey: 'page.pricing.title', subtitleKey: 'page.pricing.subtitle' },
};

const MEDIA_KIND_LABELS = {
  embedding: 'Embedding',
  image: 'Text to Image',
  video: 'Video',
  tts: 'Text To Speech',
  stt: 'Speech To Text',
  web: 'Web Fetch & Search',
};

function computeRouteInfo(pathname, t) {
  if (ROUTE_META[pathname]) {
    if (pathname === '/settings/pricing') {
      return {
        meta: ROUTE_META[pathname],
        breadcrumbs: [
          { label: t('nav.settings'), to: '/settings' },
          { label: t('nav.pricing'), to: '/settings/pricing' },
        ],
      };
    }
    return { meta: ROUTE_META[pathname], breadcrumbs: null };
  }

  if (pathname.startsWith('/providers/')) {
    const id = decodeURIComponent(pathname.slice('/providers/'.length).split('/')[0] || '');
    return {
      meta: {
        titleKey: 'page.providerDetail.title',
        subtitleKey: 'page.providerDetail.subtitle',
      },
      breadcrumbs: [
        { label: t('nav.providers'), to: '/providers' },
        { label: id || 'Provider', to: pathname },
      ],
    };
  }

  if (pathname.startsWith('/media-providers/')) {
    const parts = pathname
      .slice('/media-providers/'.length)
      .split('/')
      .filter(Boolean)
      .map((p) => decodeURIComponent(p));
    const kind = parts[0] || 'embedding';
    const providerId = parts[1] || '';
    const kindLabel = MEDIA_KIND_LABELS[kind] || kind;
    const crumbs = [
      { label: t('nav.mediaProviders'), to: `/media-providers/${kind}` },
      { label: kindLabel, to: `/media-providers/${kind}` },
    ];
    if (providerId) {
      crumbs.push({ label: providerId, to: pathname });
    }
    return {
      meta: {
        titleKey: 'page.mediaProviders.title',
        subtitleKey: 'page.mediaProviders.subtitle',
      },
      breadcrumbs: crumbs,
    };
  }

  return { meta: ROUTE_META['/'], breadcrumbs: null };
}

export function SidebarLayout() {
  const { logout, defaultPassword } = useAuth();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { locale, toggleLocale, t } = useLocale();
  const location = useLocation();
  const navigate = useNavigate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [headerSearch, setHeaderSearch] = useState('');
  const [health, setHealth] = useState({ ok: null, port: 20128 });
  const [enableTranslator, setEnableTranslator] = useState(true);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const drawerRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const menuPopoverRef = useRef(null);
  const menuGroupRef = useRef(null);

  const syncSettings = useCallback(async () => {
    try {
      const res = await settingsApi.get();
      if (res?.settings) {
        setEnableTranslator(res.settings.enableTranslator !== false);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    syncSettings();
    const onSettingsChanged = () => syncSettings();
    window.addEventListener('001router:settings-updated', onSettingsChanged);
    return () => window.removeEventListener('001router:settings-updated', onSettingsChanged);
  }, [syncSettings]);

  useEffect(() => {
    let active = true;
    const pollHealth = async () => {
      try {
        const res = await healthApi.check();
        if (active) setHealth({ ok: Boolean(res?.ok), port: res?.port || 20128 });
      } catch {
        if (active) setHealth((prev) => ({ ...prev, ok: false }));
      }
    };
    pollHealth();
    const timer = setInterval(pollHealth, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  // Reset mobile drawer & contextual header search on route change
  useEffect(() => {
    setDrawerOpen(false);
    setHeaderSearch('');
    const pop = menuPopoverRef.current;
    if (pop && pop.matches?.(':popover-open')) {
      try {
        pop.hidePopover();
      } catch {
        // ignore
      }
    }
  }, [location.pathname]);

  useEffect(() => {
    const dialog = drawerRef.current;
    if (!dialog) return;
    if (drawerOpen && !dialog.open) {
      dialog.returnValue = '';
      dialog.showModal();
    } else if (!drawerOpen && dialog.open) {
      dialog.close();
      dialog.returnValue = '';
    }
  }, [drawerOpen]);

  // Modern Web Guidance (menu): Popover toggle sync, anchor positioning fallback, and focusgroup keyboard fallback
  const positionMenuFallback = useCallback(() => {
    if (typeof CSS !== 'undefined' && CSS.supports?.('position-area: block-end')) return;
    const trigger = menuTriggerRef.current;
    const pop = menuPopoverRef.current;
    if (!trigger || !pop) return;
    const rect = trigger.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 260, rect.bottom + 6);
    const right = Math.max(12, window.innerWidth - rect.right);
    pop.style.top = `${top}px`;
    pop.style.right = `${right}px`;
    pop.style.left = 'auto';
  }, []);

  useEffect(() => {
    const pop = menuPopoverRef.current;
    const group = menuGroupRef.current;
    const trigger = menuTriggerRef.current;
    if (!pop || !group || !trigger) return;

    const supportsFocusGroup = 'focusGroup' in HTMLElement.prototype;
    if (!supportsFocusGroup) {
      group.setAttribute('role', 'menu');
      for (const btn of group.querySelectorAll('button')) {
        btn.setAttribute('role', 'menuitem');
      }
    }

    const handleBeforeToggle = (e) => {
      if (e.newState === 'open') {
        positionMenuFallback();
      }
    };

    const handleToggle = (e) => {
      const open = e.newState === 'open';
      setMenuOpen(open);
      if (open) {
        positionMenuFallback();
        const firstBtn = group.querySelector('button:not(:disabled)');
        firstBtn?.focus();
      }
    };

    const handleKeyDown = (e) => {
      if (supportsFocusGroup) return;
      const items = [...group.querySelectorAll('button:not(:disabled)')];
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        items[items.length - 1]?.focus();
      }
    };

    pop.addEventListener('beforetoggle', handleBeforeToggle);
    pop.addEventListener('toggle', handleToggle);
    group.addEventListener('keydown', handleKeyDown);
    return () => {
      pop.removeEventListener('beforetoggle', handleBeforeToggle);
      pop.removeEventListener('toggle', handleToggle);
      group.removeEventListener('keydown', handleKeyDown);
    };
  }, [positionMenuFallback]);

  const handleMenuTriggerClick = () => {
    if ('commandForElement' in HTMLButtonElement.prototype) return;
    const pop = menuPopoverRef.current;
    if (!pop) return;
    positionMenuFallback();
    if (typeof pop.togglePopover === 'function') {
      pop.togglePopover();
    } else {
      pop.classList.toggle(':popover-open');
      setMenuOpen(pop.classList.contains(':popover-open'));
    }
  };

  const closeMenuAndRun = (fn) => {
    const pop = menuPopoverRef.current;
    if (pop) {
      if (typeof pop.hidePopover === 'function' && pop.matches?.(':popover-open')) {
        try {
          pop.hidePopover();
        } catch {
          // ignore
        }
      } else {
        pop.classList.remove(':popover-open');
        setMenuOpen(false);
      }
    }
    fn();
  };

  const { meta, breadcrumbs } = useMemo(
    () => computeRouteInfo(location.pathname, t),
    [location.pathname, t]
  );

  const isMediaRoute = location.pathname.startsWith('/media-providers');
  const visibleDebugNav = useMemo(
    () => DEBUG_NAV.filter((item) => !item.requiresTranslator || enableTranslator),
    [enableTranslator]
  );

  const renderNavItems = (items) =>
    items.map(({ to, labelKey, icon: Icon, end, badge }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={({ isActive }) =>
          `group flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#E56A4A] ${
            isActive
              ? 'bg-[#E56A4A]/14 text-[#E56A4A]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
          }`
        }
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="single-line-truncate">{t(labelKey)}</span>
        </span>
        {badge ? (
          <span className="rounded bg-[#E56A4A]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#E56A4A]">
            {badge}
          </span>
        ) : null}
      </NavLink>
    ));

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex h-full flex-col justify-between bg-[var(--bg-sidebar)]">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Top macOS traffic-light dots + Brand tile */}
        <div className="px-4 pt-3.5 pb-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F56]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#FFBD2E]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#27C93F]" />
            </div>
            {isMobile ? (
              <button
                type="button"
                autoFocus
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#E56A4A] to-[#cc5236] text-white shadow-sm">
                <Waypoints className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[15px] font-bold tracking-tight text-[var(--text-primary)]">
                  001Router
                </div>
                <div className="font-mono text-[11px] text-[var(--text-muted)]">v2.0.0</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setChangelogOpen(true)}
              title="Release notes"
              className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#E56A4A] hover:border-[#E56A4A]/60"
            >
              NEW
            </button>
          </div>
        </div>

        {/* Scrollable Navigation */}
        <nav
          aria-label="Main navigation"
          className="flex-1 space-y-4 overflow-y-auto px-3 py-2"
        >
          <div className="space-y-0.5">{renderNavItems(MAIN_NAV)}</div>

          {/* 9Router Media Providers Collapsible Accordion (native <details>/<summary>, no heading inside summary) */}
          <details className="sidebar-accordion" open={isMediaRoute || undefined}>
            <summary className="rounded-lg px-3 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[#E56A4A]">
              <ChevronDown
                className="accordion-chevron h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
                aria-hidden="true"
              />
              <span className="single-line-truncate flex-1">{t('nav.mediaProviders')}</span>
              <span className="rounded bg-sky-500/12 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-400">
                6
              </span>
            </summary>
            <div className="mt-0.5 space-y-0.5 pl-3">
              {MEDIA_SUB_NAV.map(({ to, labelKey, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `group flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-[#E56A4A] ${
                      isActive
                        ? 'bg-[#E56A4A]/14 text-[#E56A4A]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                    }`
                  }
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="single-line-truncate">{t(labelKey)}</span>
                </NavLink>
              ))}
            </div>
          </details>

          <div>
            <div className="mb-1.5 px-3 text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
              {t('nav.debugSection')}
            </div>
            <div className="space-y-0.5">{renderNavItems(visibleDebugNav)}</div>
          </div>

          <div>
            <div className="mb-1.5 px-3 text-[10px] font-semibold tracking-wider text-[var(--text-muted)] uppercase">
              {t('nav.systemSection')}
            </div>
            <div className="space-y-0.5">{renderNavItems(SYSTEM_NAV)}</div>
          </div>
        </nav>
      </div>

      {/* Bottom Status, Landing Link & ToS-Safe Compliance Box */}
      <div className="space-y-2 border-t border-[var(--border-subtle)] p-3">
        <Link
          to="/landing"
          className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[#E56A4A]/50 hover:text-[var(--text-primary)]"
        >
          <span>{t('nav.landing')}</span>
          <ExternalLink className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-[var(--bg-main)] text-[var(--text-primary)]">
      {/* Persistent Desktop Sidebar (260px) */}
      <aside className="hidden w-[260px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] lg:sticky lg:top-0 lg:block lg:h-dvh">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Navigation Drawer (<dialog showModal>) */}
      <dialog
        ref={drawerRef}
        className="nav-drawer"
        aria-label="Navigation menu"
        closedby="any"
        onClose={() => {
          if (drawerRef.current) drawerRef.current.returnValue = '';
          setDrawerOpen(false);
        }}
        onClick={(e) => {
          if (e.target === drawerRef.current) {
            setDrawerOpen(false);
          }
        }}
      >
        {drawerOpen ? renderSidebarContent(true) : null}
      </dialog>

      {/* Main Content Shell */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Default Password Top Nudge Banner if still using 1234 */}
        {defaultPassword && location.pathname !== '/settings' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs sm:px-6 lg:px-8">
            <span className="inline-flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Security tip: Your dashboard is currently using the default password{' '}
                <code>1234</code>.
              </span>
            </span>
            <Link to="/settings" className="font-semibold text-amber-300 hover:underline">
              Change password in Settings →
            </Link>
          </div>
        ) : null}

        {/* 9Router Top Header Bar */}
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/92 px-4 py-3.5 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              className="r-btn-secondary p-2 lg:hidden"
            >
              <Menu className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="min-w-0">
              {breadcrumbs ? (
                <nav aria-label="Breadcrumbs" className="r-breadcrumb">
                  <ol>
                    {breadcrumbs.map((crumb, idx) => {
                      const isLast = idx === breadcrumbs.length - 1;
                      return (
                        <li key={`${crumb.to}-${idx}`}>
                          <Link
                            to={crumb.to}
                            aria-current={isLast ? 'page' : undefined}
                            className={`truncate text-base sm:text-lg ${
                              isLast
                                ? 'font-semibold text-[var(--text-primary)]'
                                : 'font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {crumb.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </nav>
              ) : (
                <h1 className="truncate text-lg font-semibold tracking-tight text-[var(--text-primary)] sm:text-xl">
                  {t(meta.titleKey)}
                </h1>
              )}
              <p className="hidden truncate text-xs text-[var(--text-secondary)] sm:block">
                {t(meta.subtitleKey)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5">
            {meta.searchable ? (
              <div className="relative hidden w-56 md:block xl:w-64">
                <Search
                  className="pointer-events-none absolute inset-y-0 left-3 my-auto h-3.5 w-3.5 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  placeholder={t(meta.searchPlaceholderKey || 'common.search')}
                  aria-label={t(meta.searchPlaceholderKey || 'common.search')}
                  className="field-input w-full py-1.5 pr-3 pl-8 text-xs"
                />
              </div>
            ) : null}

            {/* Language Switcher */}
            <button
              type="button"
              onClick={toggleLocale}
              title={locale === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
              className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
            >
              <Globe className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
              <span className="hidden font-medium sm:inline">
                {locale === 'vi' ? 'Tiếng Việt' : 'English'}
              </span>
            </button>

            {/* Light / Dark Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              title={resolvedTheme === 'dark' ? t('common.switchLight') : t('common.switchDark')}
              aria-label={
                resolvedTheme === 'dark' ? t('common.switchLight') : t('common.switchDark')
              }
              className="r-btn-secondary flex h-8 w-8 items-center justify-center p-0"
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 text-slate-700" aria-hidden="true" />
              )}
            </button>

            {/* 9Router Header Action Menu (Popover + Invoker Command + Focusgroup) */}
            <button
              ref={menuTriggerRef}
              type="button"
              commandfor="header-action-menu"
              command="toggle-popover"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Quick menu"
              onClick={handleMenuTriggerClick}
              className="r-btn-secondary flex h-8 w-8 items-center justify-center p-0"
            >
              <LayoutGrid className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
            </button>
            <div
              ref={menuPopoverRef}
              id="header-action-menu"
              popover="auto"
              className="header-menu-popover"
            >
              <div ref={menuGroupRef} focusgroup="menu nomemory" className="flex flex-col py-1">
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => setChangelogOpen(true))}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
                >
                  <History className="h-3.5 w-3.5 text-[#E56A4A]" aria-hidden="true" />
                  <span>Changelog (v2.0.0)</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => navigate('/settings/pricing'))}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
                >
                  <DollarSign className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                  <span>{t('nav.pricing')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => navigate('/skills'))}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
                >
                  <BookOpen className="h-3.5 w-3.5 text-sky-400" aria-hidden="true" />
                  <span>{t('nav.skills')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => navigate('/landing'))}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
                  <span>{t('nav.landing')}</span>
                </button>
                <div className="my-1 border-t border-[var(--border-subtle)]" />
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => logout())}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-red-500 hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t('common.logout')}</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Workspace with 9Router faint grid */}
        <main className="landing-grid flex-1">
          <div
            key={location.pathname}
            className="page-enter mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8"
          >
            {/* Pages are lazy-loaded; keep the sidebar/header mounted while a chunk loads. */}
            <Suspense
              fallback={
                <div
                  className="flex min-h-[40vh] items-center justify-center"
                  role="status"
                  aria-live="polite"
                >
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[#E56A4A] motion-reduce:animate-none" />
                  <span className="sr-only">{t('common.loading')}</span>
                </div>
              }
            >
              <Outlet context={{ headerSearch, setHeaderSearch }} />
            </Suspense>
          </div>
        </main>
      </div>

      <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />
    </div>
  );
}
