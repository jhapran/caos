/**
 * IMP-042 (UI slice) — My Work: the waiting-reason dialog.
 *
 * DM-SM-05: entering `waiting` REQUIRES a non-empty reason — the
 * transition_task command rejects an empty one (conflict). This dialog is
 * the client-side UX mirror of that rule: the confirm action stays disabled
 * until a non-blank reason exists. The server remains authoritative.
 */
import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface WaitingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  busy: boolean;
  onConfirm: (reason: string) => void;
}

export default function WaitingDialog({ open, onOpenChange, taskTitle, busy, onConfirm }: WaitingDialogProps) {
  const [reason, setReason] = useState('');

  // Reset the form whenever the dialog opens — adjust-during-render (no
  // setState in an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setReason('');
  }

  const ready = /[^ \t\n\r]/.test(reason);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    onConfirm(reason.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as waiting</DialogTitle>
          <DialogDescription>
            {taskTitle} — record what this task is blocked on. The reason stays with the task until
            work resumes.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mywork-waiting-reason">Waiting reason</Label>
            <textarea
              id="mywork-waiting-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="e.g. Awaiting bank statements for April–August from the client…"
              className="w-full resize-none rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-brand/50"
            />
            {!ready && (
              <p className="text-[11.5px] text-ink-3">
                A waiting reason is required — the server rejects an empty reason.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy ? 'Saving…' : 'Mark as waiting'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
