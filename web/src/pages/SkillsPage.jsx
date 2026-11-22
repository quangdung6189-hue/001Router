import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen,
  Cpu,
  ExternalLink,
  Eye,
  Globe,
  Image,
  MessageSquare,
  Mic,
  Search,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { skillsApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { CopyButton } from '../components/CopyButton';
import { ModalDialog } from '../components/ModalDialog';

const SKILL_ICONS = {
  '001router': Sparkles,
  '001router-chat': MessageSquare,
  '001router-image': Image,
  '001router-tts': Volume2,
  '001router-stt': Mic,
  '001router-embeddings': Cpu,
  '001router-web-search': Search,
  '001router-web-fetch': Globe,
};

export function SkillsPage() {
  const toast = useToast();
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [previewSkill, setPreviewSkill] = useState(null);
  const [previewMarkdown, setPreviewMarkdown] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  const origin = window.location.origin;
  const entryUrl = `${origin}/api/skills/001router/SKILL.md`;
  const aiPastePrompt = `Read this skill and use it: ${entryUrl}`;

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await skillsApi.list();
      setSkills(res?.skills || []);
    } catch (err) {
      toast.error(err?.message || 'Failed to load agent skills');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const openPreview = async (skill) => {
    setPreviewSkill(skill);
    setPreviewMarkdown('');
    setLoadingPreview(true);
    try {
      const md = await skillsApi.getMarkdown(skill.id);
      setPreviewMarkdown(md);
    } catch (err) {
      toast.error(err?.message || 'Failed to load SKILL.md');
      setPreviewMarkdown('# Failed to load skill document');
    } finally {
      setLoadingPreview(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Exact 9Router "Paste this to your AI" Entry Card */}
      <section className="r-card border-[#E56A4A]/40 bg-gradient-to-br from-[#E56A4A]/10 via-[var(--bg-card)] to-[var(--bg-card)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2">
              <span className="rounded-full bg-[#E56A4A] px-2 py-0.5 font-mono text-[10px] font-bold text-white">
                START HERE
              </span>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                Paste this to your AI Agent (Claude Code, Codex, Cursor, OpenClaw…)
              </h2>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Give any autonomous coding or chat agent instant discovery of your local 001Router
              gateway endpoints (Chat, Image, TTS, STT, Embeddings, Web Search &amp; Web Fetch).
            </p>
          </div>
          <CopyButton
            value={aiPastePrompt}
            label="Copy Prompt"
            toastMessage="Copied AI agent skill instruction"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E56A4A]/35 bg-[var(--bg-subtle)] px-4 py-3">
          <code className="font-mono text-xs font-semibold text-[var(--text-primary)] select-all break-all sm:text-sm">
            {aiPastePrompt}
          </code>
          <a
            href={entryUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#E56A4A] hover:underline"
          >
            Open raw SKILL.md
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </section>

      {/* All 8 Skills Grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#E56A4A]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Available Skills ({skills.length})
            </h2>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            Public read-only <code>/api/skills/:id/SKILL.md</code> endpoints
          </span>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="r-card h-40 animate-pulse p-5" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {skills.map((skill) => {
              const Icon = SKILL_ICONS[skill.id] || BookOpen;
              const skillUrl = `${origin}/api/skills/${skill.id}/SKILL.md`;
              const isEntry = skill.id === '001router' || skill.isEntry;

              return (
                <article
                  key={skill.id}
                  className={`r-card flex flex-col justify-between p-5 transition-colors hover:border-[#E56A4A]/60 ${
                    isEntry ? 'border-[#E56A4A]/50' : ''
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#E56A4A]/14 text-[#E56A4A]">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                            {skill.name || skill.title || skill.id}
                          </h3>
                          <code className="font-mono text-[11px] text-[var(--text-muted)]">
                            {skill.id}
                          </code>
                        </div>
                      </div>
                      {isEntry ? (
                        <span className="shrink-0 rounded-full bg-[#E56A4A]/15 px-2 py-0.5 font-mono text-[10px] font-bold text-[#E56A4A]">
                          START HERE
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {skill.description}
                    </p>

                    {skill.endpoint ? (
                      <div className="mt-3">
                        <code className="rounded bg-[var(--bg-subtle)] px-2 py-0.5 font-mono text-[11px] text-[#E56A4A]">
                          {skill.endpoint}
                        </code>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
                    <button
                      type="button"
                      onClick={() => openPreview(skill)}
                      className="r-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      Preview SKILL.md
                    </button>

                    <CopyButton
                      value={skillUrl}
                      size="xs"
                      label="Copy Link"
                      toastMessage={`Copied ${skill.id} SKILL.md link`}
                    />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Preview SKILL.md Modal */}
      <ModalDialog
        open={Boolean(previewSkill)}
        onClose={() => setPreviewSkill(null)}
        title={previewSkill ? `${previewSkill.name || previewSkill.id} — SKILL.md` : 'SKILL.md'}
        subtitle={previewSkill ? `${origin}/api/skills/${previewSkill.id}/SKILL.md` : ''}
        size="lg"
        footer={
          previewSkill ? (
            <div className="flex items-center justify-end gap-2">
              <CopyButton
                value={previewMarkdown}
                label="Copy Markdown"
                toastMessage="Copied full SKILL.md content"
              />
              <button
                type="button"
                onClick={() => setPreviewSkill(null)}
                className="r-btn-primary px-4 py-1.5 text-xs"
              >
                Done
              </button>
            </div>
          ) : null
        }
      >
        {loadingPreview ? (
          <div className="py-12 text-center text-xs text-[var(--text-muted)]">
            Loading SKILL.md…
          </div>
        ) : (
          <pre className="code-surface max-h-[60vh] overflow-auto rounded-xl border p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {previewMarkdown}
          </pre>
        )}
      </ModalDialog>
    </div>
  );
}
