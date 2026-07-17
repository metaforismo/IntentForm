"use client";

import { Check, ChatCircle, Robot, X } from "@phosphor-icons/react";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { useEffect, useState } from "react";

type ReviewThread = SemanticInterfaceGraph["reviewThreads"][number];
type ReviewAnchor = ReviewThread["anchor"];

interface ReviewPanelProps {
  graph: SemanticInterfaceGraph;
  open: boolean;
  draftAnchor: ReviewAnchor | null;
  activeThreadId: string | null;
  onActiveThread(threadId: string | null): void;
  onCreate(anchor: ReviewAnchor, body: string): void;
  onReply(threadId: string, body: string): void;
  onResolve(threadId: string, resolved: boolean): void;
  onClose(): void;
}

export function ReviewPanel({
  graph,
  open,
  draftAnchor,
  activeThreadId,
  onActiveThread,
  onCreate,
  onReply,
  onResolve,
  onClose,
}: ReviewPanelProps) {
  const [body, setBody] = useState("");
  const active = graph.reviewThreads.find((thread) => thread.id === activeThreadId) ?? null;
  const threads = [...graph.reviewThreads].sort((left, right) => right.messages[0]!.createdAt.localeCompare(left.messages[0]!.createdAt));

  useEffect(() => setBody(""), [activeThreadId, draftAnchor]);
  if (!open) return null;

  const submit = () => {
    const message = body.trim();
    if (!message) return;
    if (draftAnchor) onCreate(draftAnchor, message);
    else if (active) onReply(active.id, message);
    setBody("");
  };

  return (
    <aside data-testid="review-panel" aria-label="Review comments" className="absolute right-3 top-14 z-[8] flex max-h-[calc(100%-72px)] w-[320px] flex-col overflow-hidden rounded-[8px] border border-[var(--line)] bg-[var(--if-app)] text-[var(--if-text)] shadow-[0_20px_60px_rgba(0,0,0,.38)]">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--line)] px-3">
        <div className="flex items-center gap-2"><ChatCircle size={14} /><strong className="text-[11.5px] font-medium">Review</strong><span className="rounded-[4px] bg-[var(--hover)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--faint)]">{graph.reviewThreads.filter((thread) => !thread.resolvedAt).length} open</span></div>
        <button type="button" aria-label="Close review comments" onClick={onClose} className="grid size-7 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)]"><X size={13} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {draftAnchor ? <div className="border-b border-[var(--line)] p-3"><p className="mb-2 text-[10px] text-[var(--faint)]">New comment · {draftAnchor.nodeId ?? draftAnchor.screenId}</p><CommentComposer value={body} onChange={setBody} onSubmit={submit} submitLabel="Post comment" /></div> : null}
        {active ? <ThreadDetail thread={active} body={body} onBody={setBody} onSubmit={submit} onResolve={() => onResolve(active.id, !active.resolvedAt)} /> : !draftAnchor ? <div className="divide-y divide-[var(--line)]">{threads.length ? threads.map((thread) => <button key={thread.id} type="button" onClick={() => onActiveThread(thread.id)} className="block w-full px-3 py-3 text-left hover:bg-[var(--hover)]"><span className="mb-1 flex items-center gap-1.5 text-[9.5px] text-[var(--faint)]">{thread.messages[0]!.author.kind === "agent" ? <Robot size={11} /> : null}{thread.messages[0]!.author.name}<span>·</span><time>{new Date(thread.messages[0]!.createdAt).toLocaleString()}</time>{thread.resolvedAt ? <Check size={11} className="ml-auto text-[var(--success)]" /> : null}</span><span className="line-clamp-2 text-[11px] leading-[17px] text-[var(--if-text-secondary)]">{thread.messages[0]!.body}</span></button>) : <p className="p-5 text-center text-[10.5px] leading-4 text-[var(--faint)]">Choose the comment tool, then click a layer to anchor a review thread.</p>}</div> : null}
      </div>
    </aside>
  );
}

function ThreadDetail({ thread, body, onBody, onSubmit, onResolve }: { thread: ReviewThread; body: string; onBody(value: string): void; onSubmit(): void; onResolve(): void }) {
  return <div className="p-3"><div className="mb-3 flex items-center justify-between gap-2"><span className="font-mono text-[9px] text-[var(--faint)]">{thread.anchor.nodeId ?? thread.anchor.screenId}</span><button type="button" onClick={onResolve} className="rounded-[5px] border border-[var(--line)] px-2 py-1 text-[9.5px] text-[var(--muted)] hover:bg-[var(--hover)]">{thread.resolvedAt ? "Reopen" : "Resolve"}</button></div><div className="grid gap-3">{thread.messages.map((message) => <article key={message.id} className="rounded-[7px] bg-[var(--hover)] p-2.5"><header className="mb-1.5 flex items-center gap-1.5 text-[9.5px] text-[var(--faint)]">{message.author.kind === "agent" ? <Robot size={11} /> : null}<strong className="font-medium text-[var(--if-text-secondary)]">{message.author.name}</strong><span>·</span><time>{new Date(message.createdAt).toLocaleString()}</time></header><p className="whitespace-pre-wrap text-[11px] leading-[17px]">{message.body}</p>{message.transactionId ? <span className="mt-2 block font-mono text-[8.5px] text-[var(--if-blue)]">transaction {message.transactionId}</span> : null}</article>)}</div>{!thread.resolvedAt ? <div className="mt-3"><CommentComposer value={body} onChange={onBody} onSubmit={onSubmit} submitLabel="Reply" /></div> : null}</div>;
}

function CommentComposer({ value, onChange, onSubmit, submitLabel }: { value: string; onChange(value: string): void; onSubmit(): void; submitLabel: string }) {
  return <div className="grid gap-2"><textarea data-testid="review-comment-body" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onSubmit(); }} rows={3} maxLength={4_000} placeholder="Leave precise feedback…" className="resize-none rounded-[6px] border border-[var(--line)] bg-[var(--field)] px-2.5 py-2 text-[11px] leading-4 outline-none focus:border-[var(--if-blue)]" /><button data-testid="review-comment-submit" type="button" disabled={!value.trim()} onClick={onSubmit} className="justify-self-end rounded-[5px] bg-[var(--if-blue)] px-2.5 py-1.5 text-[10px] font-medium text-white disabled:opacity-40">{submitLabel}</button></div>;
}
