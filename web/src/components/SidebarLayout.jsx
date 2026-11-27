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
  Film,
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
  Power,
  PowerOff,
  Scissors,
  ScrollText,
  Search,
  Server,
  Settings,
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
import { healthApi, settingsApi, versionApi } from '../lib/api';
import { ChangelogModal } from './ChangelogModal';
import { ConfirmDialog } from './ConfirmDialog';

const PRIMARY_NAV = [
  { to: '/', labelKey: 'nav.endpoint', icon: KeyRound, end: true },
  { to: '/providers', labelKey: 'nav.providers', icon: Server },
  { to: '/combos', labelKey: 'nav.combos', icon: Layers },
  { to: '/usage', labelKey: 'nav.usage', icon: BarChart3 },
  { to: '/quota', labelKey: 'nav.quota', icon: Cpu },
  { to: '/token-saver', labelKey: 'nav.tokenSaver', icon: Scissors },
  { to: '/cli-tools', labelKey: 'nav.cliTools', icon: Terminal },
];

const MEDIA_SUB_NAV = [
  { to: '/media-providers/embedding', labelKey: 'nav.media.embedding', icon: Cpu },
  { to: '/media-providers/image', labelKey: 'nav.media.image', icon: Image },
  { to: '/media-providers/video', labelKey: 'nav.media.video', icon: Film },
  { to: '/media-providers/tts', labelKey: 'nav.media.tts', icon: Volume2 },
  { to: '/media-providers/stt', labelKey: 'nav.media.stt', icon: Mic },
  { to: '/media-providers/systemone', labelKey: 'nav.media.systemone', icon: Sparkles },
  { to: '/media-providers/web', labelKey: 'nav.media.web', icon: Globe },
];

const SYSTEM_NAV = [
  { to: '/proxy-pools', labelKey: 'nav.proxyPools', icon: Network },
  { to: '/skills', labelKey: 'nav.skills', icon: BookOpen },
  { to: '/console-log', labelKey: 'nav.consoleLog', icon: ScrollText },
  { to: '/translator', labelKey: 'nav.translator', icon: ArrowLeftRight, requiresTranslator: true },
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
  '/mitm': { titleKey: 'page.mitm.title', subtitleKey: 'page.mitm.subtitle' },
  '/models': {
    titleKey: 'page.models.title',
    subtitleKey: 'page.models.subtitle',
    searchable: true,
    searchPlaceholderKey: 'providers.searchPlaceholder',
  },
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
  systemone: 'SystemOne',
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

  const safeDecode = (seg) => {
    try {
      return decodeURIComponent(seg);
    } catch {
      return seg;
    }
  };

  if (pathname.startsWith('/providers/')) {
    const id = safeDecode(pathname.slice('/providers/'.length).split('/')[0] || '');
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

  if (pathname.startsWith('/cli-tools/')) {
    const toolId = safeDecode(pathname.slice('/cli-tools/'.length).split('/')[0] || '');
    return {
      meta: {
        titleKey: 'page.cliTools.title',
        subtitleKey: 'page.cliTools.subtitle',
      },
      breadcrumbs: [
        { label: t('nav.cliTools'), to: '/cli-tools' },
        { label: toolId || 'Tool', to: pathname },
      ],
    };
  }

  if (pathname.startsWith('/media-providers/')) {
    const parts = pathname
      .slice('/media-providers/'.length)
      .split('/')
      .filter(Boolean)
      .map((p) => safeDecode(p));
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
  const [shutdownConfirmOpen, setShutdownConfirmOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const drawerRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const menuPopoverRef = useRef(null);
  const menuGroupRef = useRef(null);
  const searchInputRef = useRef(null);
  const enterMenuOnOpenRef = useRef(false);
  const pointerTriggerRef = useRef(false);

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

  // Modern Web Guidance (menu): Popover toggle, keyboard-only entry, anchor fallback, focusgroup fallback
  const positionMenuFallback = useCallback(() => {
    const hasNativeAnchor =
      typeof CSS !== 'undefined' &&
      CSS.supports?.('position-area: block-end') &&
      typeof HTMLButtonElement !== 'undefined' &&
      'commandForElement' in HTMLButtonElement.prototype;
    if (hasNativeAnchor) return;
    const trigger = menuTriggerRef.current;
    const pop = menuPopoverRef.current;
    if (!trigger || !pop) return;
    const rect = trigger.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 280, rect.bottom + 6);
    const right = Math.max(12, window.innerWidth - rect.right);
    pop.style.top = `${top}px`;
    pop.style.right = `${right}px`;
    pop.style.left = 'auto';
  }, []);

  useEffect(() => {
    const pop = menuPopoverRef.current;
    const group = menuGroupRef.current;
    const trigger = menuTriggerRef.current;
    if (!pop || !group || !trigger) return undefined;

    const supportsFocusGroup = 'focusGroup' in HTMLElement.prototype;
    if (!supportsFocusGroup) {
      group.setAttribute('role', 'menu');
      for (const btn of group.querySelectorAll('button:not([role])')) {
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
        const shouldEnter = enterMenuOnOpenRef.current && !pointerTriggerRef.current;
        enterMenuOnOpenRef.current = false;
        pointerTriggerRef.current = false;
        if (shouldEnter) {
          group.querySelector('button:not(:disabled)')?.focus();
        }
      } else {
        enterMenuOnOpenRef.current = false;
        pointerTriggerRef.current = false;
      }
    };

    const handleTriggerKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (pop.matches?.(':popover-open')) {
          group.querySelector('button:not(:disabled)')?.focus();
        } else {
          enterMenuOnOpenRef.current = true;
          trigger.click();
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (!pop.matches?.(':popover-open')) {
          enterMenuOnOpenRef.current = true;
        }
      }
    };

    const handleTriggerPointerDown = () => {
      pointerTriggerRef.current = true;
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Tab') {
        if (pop.matches?.(':popover-open')) {
          try {
            pop.hidePopover();
          } catch {
            // ignore
          }
        }
        return;
      }
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
    trigger.addEventListener('keydown', handleTriggerKeyDown);
    trigger.addEventListener('pointerdown', handleTriggerPointerDown);
    group.addEventListener('keydown', handleKeyDown);
    return () => {
      pop.removeEventListener('beforetoggle', handleBeforeToggle);
      pop.removeEventListener('toggle', handleToggle);
      trigger.removeEventListener('keydown', handleTriggerKeyDown);
      trigger.removeEventListener('pointerdown', handleTriggerPointerDown);
      group.removeEventListener('keydown', handleKeyDown);
    };
  }, [positionMenuFallback]);

  const handleMenuTriggerClick = () => {
    if ('commandForElement' in HTMLButtonElement.prototype) return;
    const pop = menuPopoverRef.current;
    if (!pop) return;
    positionMenuFallback();
    if (typeof pop.togglePopover === 'function') {
      try {
        pop.togglePopover({ source: menuTriggerRef.current });
      } catch {
        pop.togglePopover();
      }
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

  const handleConfirmShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await versionApi.shutdown();
    } catch {
      // Expected once the socket closes mid-response
    } finally {
      setIsShuttingDown(false);
      setShutdownConfirmOpen(false);
      setIsDisconnected(true);
    }
  };

  const { meta, breadcrumbs } = useMemo(
    () => computeRouteInfo(location.pathname, t),
    [location.pathname, t]
  );

  // Quick `/` keyboard shortcut to focus contextual header search
  useEffect(() => {
    if (!meta.searchable) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        document.activeElement?.isContentEditable ||
        document.querySelector('dialog:modal')
      ) {
        return;
      }
      if (searchInputRef.current && searchInputRef.current.offsetParent !== null) {
        e.preventDefault();
        searchInputRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [meta.searchable]);

  const isMediaRoute = location.pathname.startsWith('/media-providers');
  const visibleSystemNav = useMemo(
    () => SYSTEM_NAV.filter((item) => !item.requiresTranslator || enableTranslator),
    [enableTranslator]
  );

  const renderNavItems = (items) =>
    items.map(({ to, labelKey, icon: Icon, end }) => (
      <NavLink
        key={to}
        to={to}
        end={end}
        className={({ isActive }) =>
          `r-nav-link group flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-[#E56A4A] ${
            isActive
              ? 'bg-[#E56A4A]/12 text-[#E56A4A]'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
          }`
        }
      >
        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        <span className="single-line-truncate">{t(labelKey)}</span>
      </NavLink>
    ));

  const renderSidebarContent = (isMobile = false) => (
    <div className="flex h-full flex-col bg-[var(--bg-sidebar)] backdrop-blur-xl">
      {/* Traffic lights — exact 9Router top bar */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2">
        <div className="flex items-center gap-2" aria-hidden="true">
          <div className="h-3 w-3 rounded-full bg-[#FF5F56]" />
          <div className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
          <div className="h-3 w-3 rounded-full bg-[#27C93F]" />
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

      {/* Logo — exact 9Router brand tile */}
      <div className="flex flex-col gap-2 px-6 py-4">
        <Link to="/" className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#E56A4A] to-[#c44d2e] text-white shadow-[0_4px_14px_rgba(229,106,74,0.28)]">
            <Waypoints className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-lg font-semibold tracking-tight text-[var(--text-primary)]">
              001Router
            </span>
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <span>v2.0.0</span>
              <span
                title={
                  health.ok === true
                    ? `Online · :${health.port}`
                    : health.ok === false
                      ? 'Disconnected'
                      : 'Checking…'
                }
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  health.ok === true
                    ? 'bg-emerald-500'
                    : health.ok === false
                      ? 'bg-red-500'
                      : 'bg-[var(--text-muted)]'
                }`}
              />
            </div>
          </div>
        </Link>
      </div>

      {/* Navigation — exact 9Router order */}
      <nav aria-label="Main navigation" className="flex-1 space-y-0.5 overflow-y-auto px-4 py-2">
        {renderNavItems(PRIMARY_NAV)}

        {/* System Section */}
        <div className="mt-2 space-y-0.5 pt-3">
          <p className="mb-2 px-3 text-xs font-semibold tracking-wider text-[var(--text-muted)] uppercase">
            {t('nav.systemSection')}
          </p>

          {/* Media Providers Accordion */}
          <details className="sidebar-accordion" open={isMediaRoute || undefined}>
            <summary className="rounded-lg px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-[#E56A4A]">
              <Image className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              <span className="single-line-truncate flex-1 text-left">
                {t('nav.mediaProviders')}
              </span>
              <ChevronDown
                className="accordion-chevron h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-0.5 space-y-0.5 pl-4">
              {MEDIA_SUB_NAV.map(({ to, labelKey, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `r-nav-link group flex items-center gap-3 rounded-lg px-3 py-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-[#E56A4A] ${
                      isActive
                        ? 'bg-[#E56A4A]/12 text-[#E56A4A]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="single-line-truncate">{t(labelKey)}</span>
                </NavLink>
              ))}
            </div>
          </details>

          {renderNavItems(visibleSystemNav)}
        </div>
      </nav>
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-[var(--bg-main)] text-[var(--text-primary)]">
      {/* Persistent Desktop Sidebar (w-72 = 288px, matching 9Router) */}
      <aside className="hidden w-72 shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-sidebar)] lg:sticky lg:top-0 lg:block lg:h-dvh">
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
        {/* Default Password Security Tip Banner */}
        {defaultPassword && location.pathname !== '/settings' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs lg:px-8">
            <span className="inline-flex items-center gap-1.5 font-medium text-[var(--ux-warn)]">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Security tip: Your dashboard is currently using the default password{' '}
                <code>1234</code>.
              </span>
            </span>
            <Link to="/settings" className="font-semibold text-[var(--ux-warn)] hover:underline">
              Change password in Settings →
            </Link>
          </div>
        ) : null}

        {/* Top Header Bar — matching 9Router Header.js */}
        <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--bg-main)]/85 px-4 pt-3 pb-2.5 backdrop-blur-xl lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
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
                            className={`truncate text-base lg:text-lg ${
                              isLast
                                ? 'font-semibold text-[var(--text-primary)]'
                                : 'font-medium text-[var(--text-secondary)] hover:text-[#E56A4A]'
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
                <>
                  <h1 className="truncate text-base font-semibold tracking-tight text-[var(--text-primary)] lg:text-2xl">
                    {t(meta.titleKey)}
                  </h1>
                  <p className="hidden truncate text-xs text-[var(--text-muted)] lg:block lg:text-sm">
                    {t(meta.subtitleKey)}
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {meta.searchable ? (
              <div className="relative hidden w-[160px] sm:block sm:w-[220px]">
                <Search
                  className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
                  aria-hidden="true"
                />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  placeholder={t(meta.searchPlaceholderKey || 'common.search')}
                  aria-label={t(meta.searchPlaceholderKey || 'common.search')}
                  className="field-input h-8 w-full pr-7 pl-7 text-xs"
                />
                {!headerSearch ? (
                  <kbd
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 right-2 flex h-4.5 w-4.5 -translate-y-1/2 items-center justify-center rounded border border-[var(--border-subtle)] bg-[var(--bg-subtle)] font-mono text-[10px] font-medium text-[var(--text-muted)]"
                  >
                    /
                  </kbd>
                ) : null}
              </div>
            ) : null}

            {/* Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              title={resolvedTheme === 'dark' ? t('common.switchLight') : t('common.switchDark')}
              aria-label={
                resolvedTheme === 'dark' ? t('common.switchLight') : t('common.switchDark')
              }
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
            </button>

            {/* Language Switcher */}
            <button
              type="button"
              onClick={toggleLocale}
              title={locale === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{locale === 'vi' ? 'VI' : 'EN'}</span>
            </button>

            {/* 9Router HeaderMenu (Popover + Invoker Command + focusgroup + <hr>) */}
            <button
              ref={menuTriggerRef}
              id="header-menu-trigger"
              type="button"
              commandfor="header-action-menu"
              command="toggle-popover"
              aria-haspopup="menu"
              aria-expanded={menuOpen ? 'true' : 'false'}
              aria-label="Menu"
              onClick={handleMenuTriggerClick}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </button>
            <div
              ref={menuPopoverRef}
              id="header-action-menu"
              popover="auto"
              className="header-menu-popover"
            >
              <div
                ref={menuGroupRef}
                focusgroup="menu nomemory"
                aria-labelledby="header-menu-trigger"
                className="flex flex-col py-1"
              >
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => setChangelogOpen(true))}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
                >
                  <History className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  <span>Change Log</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => toggleTheme())}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
                >
                  {resolvedTheme === 'dark' ? (
                    <Sun className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  ) : (
                    <Moon className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  )}
                  <span>Theme</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => navigate('/settings/pricing'))}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] focus-visible:outline-none"
                >
                  <DollarSign className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
                  <span>{t('nav.pricing')}</span>
                </button>
                <hr />
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => setShutdownConfirmOpen(true))}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-red-500 transition-colors hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none"
                >
                  <Power className="h-4 w-4" aria-hidden="true" />
                  <span>{t('nav.shutdown')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => closeMenuAndRun(() => logout())}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-red-500 transition-colors hover:bg-red-500/10 focus-visible:bg-red-500/10 focus-visible:outline-none"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  <span>{t('common.logout')}</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Workspace — matching 9Router padding & grid */}
        <main className="landing-grid flex-1">
          <div
            key={location.pathname}
            className="page-enter mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8"
          >
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

      <ConfirmDialog
        open={shutdownConfirmOpen}
        onClose={() => setShutdownConfirmOpen(false)}
        onConfirm={handleConfirmShutdown}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmLabel="Close"
        destructive
        busy={isShuttingDown}
      />

      {isDisconnected ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
          <div className="p-8 text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-red-500/20 text-red-500">
              <PowerOff className="h-8 w-8" aria-hidden="true" />
            </div>
            <h2 className="mb-2 text-xl font-semibold text-white">Server Disconnected</h2>
            <p className="mb-6 text-sm text-neutral-300">The proxy server has been stopped.</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="r-btn-secondary px-4 py-2 text-sm"
            >
              Reload Page
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
