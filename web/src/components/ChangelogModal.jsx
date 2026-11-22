import { ModalDialog } from './ModalDialog';

const RELEASES = [
  {
    version: 'v2.0.0',
    date: '2026-11-22',
    badge: '9Router Parity',
    highlights: [
      'Full 9Router v0.5.119 UI/UX parity: Media Providers sidebar accordion (Embedding, Image, Video, TTS, STT, Web Fetch & Search), Agent Skills hub, Provider Detail page, and Pricing Settings editor.',
      'Interactive Live Provider Topology graph with glowing router core, electric energy beams, and real-time SSE /api/usage/stream updates.',
      'Upgraded 12-filter RTK Token Saver (git-diff, git-status, git-log, build-output, grep, find, tree, ls, search-list, read-numbered, dedup-log, smart-truncate) + Ponytail Mode + Headroom external proxy + Custom Global System Prompt + X-9Router-Token-Saver: off bypass.',
      'Capacity Adapter (Vision & Audio auto-routing), Model Aliases, Disabled Models toggle, Per-Key Access Controls (403 enforcement), and Live Server Console SSE stream.',
      'Expanded API compatibility: /v1/models/info, /v1/responses/compact, /v1/audio/voices, /v1/videos/generations, /v1beta/models (Gemini), /v1/api/tags & /v1/api/chat (Ollama), and Self-hosted STT/TTS/Embedding presets.',
    ],
  },
  {
    version: 'v1.2.0',
    date: '2026-11-10',
    badge: 'Security & OAuth',
    highlights: [
      'AES-256-GCM at-rest encryption for provider keys, Service Account JSONs, OAuth credentials, and proxy pool URLs.',
      'Official OAuth 2.0 PKCE (Google Cloud, OpenRouter, GitLab, Custom OAuth) and RFC 8628 Device Code flows (Kilo Code, Nous Research).',
      '1-Click CLI Tools auto-configuration with automatic backup & reset for Claude Code, Codex, OpenCode, Cline, Kilo Code, Droid, Continue, and Aider.',
      '470+ model catalog across 56+ official providers with automated live sync.',
    ],
  },
];

export function ChangelogModal({ open, onClose }) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Changelog — 001Router"
      subtitle="Release notes & 9Router feature parity milestones"
      size="lg"
    >
      <div className="space-y-5">
        {RELEASES.map((rel) => (
          <section
            key={rel.version}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold text-[#E56A4A]">{rel.version}</span>
                <span className="rounded-full bg-[#E56A4A]/15 px-2 py-0.5 text-[11px] font-semibold text-[#E56A4A]">
                  {rel.badge}
                </span>
              </div>
              <span className="font-mono text-xs text-[var(--text-muted)]">{rel.date}</span>
            </div>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-[var(--text-secondary)]">
              {rel.highlights.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ModalDialog>
  );
}
