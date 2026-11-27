import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { LocaleProvider } from './context/LocaleContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AuthGate } from './components/AuthGate';
import { SidebarLayout } from './components/SidebarLayout';

// Route-level code splitting: each page ships as its own chunk and is fetched on first visit,
// so the initial bundle no longer carries all 21 pages (ProvidersPage alone is ~6.7k lines).
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const LandingPage = lazy(() => import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then((m) => ({ default: m.OverviewPage })));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage').then((m) => ({ default: m.ProvidersPage })));
const ProviderDetailPage = lazy(() => import('./pages/ProviderDetailPage').then((m) => ({ default: m.ProviderDetailPage })));
const MediaProvidersPage = lazy(() => import('./pages/MediaProvidersPage').then((m) => ({ default: m.MediaProvidersPage })));
const MediaProviderDetailPage = lazy(() => import('./pages/MediaProviderDetailPage').then((m) => ({ default: m.MediaProviderDetailPage })));
const ModelsPage = lazy(() => import('./pages/ModelsPage').then((m) => ({ default: m.ModelsPage })));
const CombosPage = lazy(() => import('./pages/CombosPage').then((m) => ({ default: m.CombosPage })));
const UsagePage = lazy(() => import('./pages/UsagePage').then((m) => ({ default: m.UsagePage })));
const QuotaPage = lazy(() => import('./pages/QuotaPage').then((m) => ({ default: m.QuotaPage })));
const TokenSaverPage = lazy(() => import('./pages/TokenSaverPage').then((m) => ({ default: m.TokenSaverPage })));
const CliToolsPage = lazy(() => import('./pages/CliToolsPage').then((m) => ({ default: m.CliToolsPage })));
const CliToolDetailPage = lazy(() =>
  import('./pages/CliToolDetailPage').then((m) => ({ default: m.CliToolDetailPage }))
);
const MitmPage = lazy(() => import('./pages/MitmPage').then((m) => ({ default: m.MitmPage })));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const SkillsPage = lazy(() => import('./pages/SkillsPage').then((m) => ({ default: m.SkillsPage })));
const ConsoleLogPage = lazy(() => import('./pages/ConsoleLogPage').then((m) => ({ default: m.ConsoleLogPage })));
const TranslatorPage = lazy(() => import('./pages/TranslatorPage').then((m) => ({ default: m.TranslatorPage })));
const ProxyPoolsPage = lazy(() => import('./pages/ProxyPoolsPage').then((m) => ({ default: m.ProxyPoolsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const PricingPage = lazy(() => import('./pages/PricingPage').then((m) => ({ default: m.PricingPage })));

function PageFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[#E56A4A] motion-reduce:animate-none" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route path="/landing" element={<Suspense fallback={<PageFallback />}><LandingPage /></Suspense>} />
                <Route path="/login" element={<Suspense fallback={<PageFallback />}><LoginPage /></Suspense>} />
                <Route element={<AuthGate />}>
                  <Route element={<SidebarLayout />}>
                    <Route path="/" element={<OverviewPage />} />
                    <Route path="/providers" element={<ProvidersPage />} />
                    <Route path="/providers/:id" element={<ProviderDetailPage />} />
                    <Route
                      path="/media-providers/web"
                      element={<MediaProvidersPage forcedKind="web" />}
                    />
                    <Route path="/media-providers/:kind" element={<MediaProvidersPage />} />
                    <Route
                      path="/media-providers/:kind/:id"
                      element={<MediaProviderDetailPage />}
                    />
                    <Route path="/models" element={<ModelsPage />} />
                    <Route path="/combos" element={<CombosPage />} />
                    <Route path="/usage" element={<UsagePage />} />
                    <Route path="/quota" element={<QuotaPage />} />
                    <Route path="/token-saver" element={<TokenSaverPage />} />
                    <Route path="/cli-tools" element={<CliToolsPage />} />
                    <Route path="/cli-tools/:toolId" element={<CliToolDetailPage />} />
                    <Route path="/mitm" element={<MitmPage />} />
                    <Route path="/integrations" element={<Navigate to="/cli-tools" replace />} />
                    <Route path="/playground" element={<PlaygroundPage />} />
                    <Route path="/skills" element={<SkillsPage />} />
                    <Route path="/console-log" element={<ConsoleLogPage />} />
                    <Route path="/translator" element={<TranslatorPage />} />
                    <Route path="/proxy-pools" element={<ProxyPoolsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/settings/pricing" element={<PricingPage />} />

                    {/* 9Router /dashboard/* URL aliases */}
                    <Route path="/dashboard" element={<Navigate to="/" replace />} />
                    <Route path="/dashboard/endpoint" element={<Navigate to="/" replace />} />
                    <Route path="/dashboard/providers" element={<Navigate to="/providers" replace />} />
                    <Route path="/dashboard/providers/:id" element={<ProviderDetailPage />} />
                    <Route path="/dashboard/combos" element={<Navigate to="/combos" replace />} />
                    <Route path="/dashboard/usage" element={<Navigate to="/usage" replace />} />
                    <Route path="/dashboard/quota" element={<Navigate to="/quota" replace />} />
                    <Route path="/dashboard/token-saver" element={<Navigate to="/token-saver" replace />} />
                    <Route path="/dashboard/cli-tools" element={<Navigate to="/cli-tools" replace />} />
                    <Route path="/dashboard/cli-tools/:toolId" element={<CliToolDetailPage />} />
                    <Route path="/dashboard/mitm" element={<Navigate to="/mitm" replace />} />
                    <Route path="/dashboard/proxy-pools" element={<Navigate to="/proxy-pools" replace />} />
                    <Route path="/dashboard/skills" element={<Navigate to="/skills" replace />} />
                    <Route path="/dashboard/console-log" element={<Navigate to="/console-log" replace />} />
                    <Route path="/dashboard/translator" element={<Navigate to="/translator" replace />} />
                    <Route path="/dashboard/profile" element={<Navigate to="/settings" replace />} />
                    <Route path="/dashboard/media-providers/web" element={<MediaProvidersPage forcedKind="web" />} />
                    <Route path="/dashboard/media-providers/:kind" element={<MediaProvidersPage />} />
                    <Route path="/dashboard/media-providers/:kind/:id" element={<MediaProviderDetailPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </LocaleProvider>
    </ThemeProvider>
  );
}
