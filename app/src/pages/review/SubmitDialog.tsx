/**
 * IMP-041 PASS C/C.1 — Review queue submission dialog (API-R0-RVW).
 *
 * The smallest Review Queue-owned submission interaction. Subject selection
 * is role-truthful (PASS C.1 human ruling):
 *   - 'client' mode (super_admin/partner/manager): pick a client — ad-hoc
 *     subject, clientId is the explicit subject;
 *   - 'task' mode (senior/article_executive): pick an already-visible
 *     ASSIGNED TASK from taskService (RLS-TSK-01 assigned-work scope) —
 *     clients SELECT RLS does not expose the client list to these roles
 *     (root cause proven in PASS C.1), and widening it is forbidden. The
 *     submission sends taskId only; the server derives client_id from the
 *     task authoritatively (SCH-17 subject binding). No client enumeration,
 *     no access bootstrapping.
 *
 * It calls reviewService.submitReviewItem — the UI NEVER sends firm_id /
 * submitter / status / source / decision fields; the server derives all of
 * them from the live session. Client-side required fields are UX hints only;
 * the RPC stays authoritative.
 */
import { useEffect, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, clientHierarchyService, reviewService, taskService } from '@/data';
import type { ClientRecord, ReviewItemType, TaskRecord } from '@/data';

import { REVIEW_TYPE_META, TYPE_ORDER } from './meta';

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
] as const;

/** UX narrowing only: terminal tasks are not useful review subjects. */
const OPEN_TASK = (t: TaskRecord) => t.status !== 'done' && t.status !== 'cancelled';

interface SubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'client' — ad-hoc subject (manager+); 'task' — assigned-work subject
   *  (senior/article, who cannot enumerate clients under RLS-CLI-01). */
  subjectMode: 'client' | 'task';
  /** Fired after a successful submission so the page can refetch/notify. */
  onSubmitted: () => void;
}

export default function SubmitDialog({ open, onOpenChange, subjectMode, onSubmitted }: SubmitDialogProps) {
  const [clients, setClients] = useState<ClientRecord[] | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [clientId, setClientId] = useState('');
  const [taskId, setTaskId] = useState('');
  const [type, setType] = useState<ReviewItemType | ''>('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [priority, setPriority] = useState<string>('normal');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset the form whenever the dialog opens — adjust-during-render (no
  // setState in an effect); after the correction render the guard is false.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setClientId('');
      setTaskId('');
      setType('');
      setTitle('');
      setNote('');
      setPriority('normal');
      setError(null);
    }
  }

  // Load the selectable subjects when the dialog opens — always through the
  // provider-neutral services, so a senior/article sees exactly their
  // RLS-authorized assigned work and nothing more.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (subjectMode === 'task') {
      void taskService
        .listTasks()
        .then((rows) => {
          if (!cancelled) setTasks(rows.filter(OPEN_TASK));
        })
        .catch(() => {
          if (!cancelled) setTasks([]);
        });
    } else {
      void clientHierarchyService
        .listClients()
        .then((rows) => {
          if (!cancelled) setClients(rows);
        })
        .catch(() => {
          if (!cancelled) setClients([]);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [open, subjectMode]);

  const subjectReady = subjectMode === 'task' ? !!taskId : !!clientId;
  const canSubmit = subjectReady && !!type && title.trim().length > 0 && !busy;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !type) return;
    setBusy(true);
    setError(null);
    try {
      await reviewService.submitReviewItem({
        // Linked-subject-wins: task mode sends taskId ONLY — the server
        // derives client_id; client mode sends the explicit ad-hoc clientId.
        ...(subjectMode === 'task' ? { taskId } : { clientId }),
        type,
        title: title.trim(),
        note: note.trim() || null,
        priority,
      });
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      // Provider-neutral message; never distinguishes hidden vs missing
      // subjects (API-ERR-02 holds at the presentation layer too).
      setError(err instanceof ApiError ? err.message : 'Could not submit the review item');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Submit for review</DialogTitle>
          <DialogDescription>
            {subjectMode === 'task'
              ? 'Send one of your assigned work items to the review queue. A reviewer will approve or return it.'
              : 'Send a piece of client work to the review queue. A reviewer will approve or return it.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {subjectMode === 'task' ? (
            <div className="space-y-1.5">
              <Label htmlFor="review-submit-task">Assigned work item</Label>
              <Select value={taskId} onValueChange={setTaskId}>
                <SelectTrigger id="review-submit-task">
                  <SelectValue placeholder={tasks === null ? 'Loading your assigned work…' : 'Select an assigned task'} />
                </SelectTrigger>
                <SelectContent>
                  {(tasks ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                      {t.dueDate ? ` · due ${t.dueDate}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tasks !== null && tasks.length === 0 && (
                <p className="text-[11.5px] text-ink-3">
                  No assigned work items found — only work already assigned to you can be submitted.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="review-submit-client">Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger id="review-submit-client">
                  <SelectValue placeholder={clients === null ? 'Loading clients…' : 'Select a client'} />
                </SelectTrigger>
                <SelectContent>
                  {(clients ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="review-submit-type">Work type</Label>
            <Select value={type} onValueChange={(v) => setType(v as ReviewItemType)}>
              <SelectTrigger id="review-submit-type">
                <SelectValue placeholder="Select a work type" />
              </SelectTrigger>
              <SelectContent>
                {TYPE_ORDER.map((t) => (
                  <SelectItem key={t} value={t}>
                    {REVIEW_TYPE_META[t].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-submit-title">Title</Label>
            <Input
              id="review-submit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. GSTR-2A reconciliation — August"
              maxLength={200}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-submit-note">Note for the reviewer (optional)</Label>
            <textarea
              id="review-submit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Context, open points, what to look at…"
              className="w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-brand/50"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="review-submit-priority">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="review-submit-priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p role="alert" className="text-[12.5px] text-critical">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {busy ? 'Submitting…' : 'Submit for review'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
