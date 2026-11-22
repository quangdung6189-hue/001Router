import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { LocaleProvider } from './context/LocaleContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { AuthGate } from './components/AuthGate';
import { SidebarLayout } from './components/SidebarLayout';
import { LoginPage } from './pages/LoginPage';
import { LandingPage } from './pages/LandingPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProvidersPage } from './pages/ProvidersPage';
import { ProviderDetailPage } from './pages/ProviderDetailPage';
import { MediaProvidersPage } from './pages/MediaProvidersPage';
import { MediaProviderDetailPage } from './pages/MediaProviderDetailPage';
import { ModelsPage } from './pages/ModelsPage';
import { CombosPage } from './pages/CombosPage';
import { UsagePage } from './pages/UsagePage';
import { QuotaPage } from './pages/QuotaPage';
import { TokenSaverPage } from './pages/TokenSaverPage';
import { CliToolsPage } from './pages/CliToolsPage';
import { PlaygroundPage } from './pages/PlaygroundPage';
import { SkillsPage } from './pages/SkillsPage';
import { ConsoleLogPage } from './pages/ConsoleLogPage';
import { TranslatorPage } from './pages/TranslatorPage';
import { ProxyPoolsPage } from './pages/ProxyPoolsPage';
import { SettingsPage } from './pages/SettingsPage';
import { PricingPage } from './pages/PricingPage';

export default function App() {
  return (
    <ThemeProvider>
      <LocaleProvider>
        <BrowserRouter>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route path="/landing" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
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
                    <Route path="/integrations" element={<Navigate to="/cli-tools" replace />} />
                    <Route path="/playground" element={<PlaygroundPage />} />
                    <Route path="/skills" element={<SkillsPage />} />
                    <Route path="/console-log" element={<ConsoleLogPage />} />
                    <Route path="/translator" element={<TranslatorPage />} />
                    <Route path="/proxy-pools" element={<ProxyPoolsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/settings/pricing" element={<PricingPage />} />
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
