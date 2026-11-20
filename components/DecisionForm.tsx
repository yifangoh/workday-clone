'use client'

import { useActionState } from 'react'
import { Message, SubmitButton } from './forms'
import type { ActionState } from '@/lib/types'

export function DecisionForm({
  id,
  action,
  approveLabel = 'Approve',
}: {
  id: string
  action: (s: ActionState, fd: FormData) => Promise<ActionState>
  approveLabel?: string
}) {
  const [state, formAction] = useActionState(action, undefined)
  if (state?.ok) return <Message state={state} />
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <textarea name="remark" rows={2} className="input" placeholder="Remark (required if rejecting)" />
      <Message state={state} />
      <div className="flex flex-wrap gap-2">
        <SubmitButton name="decision" value="approve" className="btn-success" pendingText="Approving…">{approveLabel}</SubmitButton>
        <SubmitButton name="decision" value="reject" className="btn-danger" pendingText="Sending back…">Reject</SubmitButton>
      </div>
    </form>
  )
}
