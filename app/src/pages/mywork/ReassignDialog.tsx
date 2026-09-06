/**
 * IMP-042 (UI slice) — My Work: the reassignment dialog (TEST-E2E-07
 * enablement).
 *
 * Reassignment is the existing taskService.updateTask contract's
 * assigneeMembershipId patch (RLS-TSK-01: the two responsibility memberships
 * are manager+ writable, enforced by the server write guard). The dialog is
 * offered only to manager+ roles (page-side role truthfulness); the
 * assignable roster loads through the existing active-firm staff directory
 * (client360Service.listActiveStaff — firm_memberships ⋈ profiles under
 * RLS), the same read path the Review Queue uses for staff display names.
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { client360Service } from '@/data';
import type { StaffRef } from '@/data';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  partner: 'Partner',
  manager: 'Manager',
  senior: 'Senior',
  article_executive: 'Article Executive',
  billing: 'Billing',
  external_consultant: 'External Consultant',
};

interface ReassignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  busy: boolean;
  onConfirm: (assigneeMembershipId: string) => void;
}

export default function ReassignDialog({ open, onOpenChange, taskTitle, busy, onConfirm }: ReassignDialogProps) {
  const [staff, setStaff] = useState<StaffRef[] | null>(null);
  const [membershipId, setMembershipId] = useState('');

  // Reset the selection whenever the dialog opens — adjust-during-render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMembershipId('');
  }

  // Load the assignable roster through the provider-neutral staff directory
  // when the dialog opens; a failed read degrades to an empty list, never
  // fabricated names.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void client360Service
      .listActiveStaff()
      .then((rows) => {
        if (!cancelled) setStaff(rows);
      })
      .catch(() => {
        if (!cancelled) setStaff([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const ready = membershipId.length > 0;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    onConfirm(membershipId);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reassign task</DialogTitle>
          <DialogDescription>
            {taskTitle} — move the assignee responsibility to another active member of the firm.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mywork-reassign-assignee">New assignee</Label>
            <Select value={membershipId} onValueChange={setMembershipId}>
              <SelectTrigger id="mywork-reassign-assignee">
                <SelectValue placeholder={staff === null ? 'Loading staff…' : 'Select an assignee'} />
              </SelectTrigger>
              <SelectContent>
                {(staff ?? []).map((s) => (
                  <SelectItem key={s.membershipId} value={s.membershipId}>
                    {s.fullName} · {ROLE_LABELS[s.role] ?? s.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {staff !== null && staff.length === 0 && (
              <p className="text-[11.5px] text-ink-3">No active staff members are visible to you.</p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {busy ? 'Saving…' : 'Reassign'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
