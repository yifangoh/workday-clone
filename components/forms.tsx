'use client'

import { useActionState, useEffect, useRef, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import clsx from 'clsx'
import type { ActionState } from '@/lib/types'

export function SubmitButton({
  children,
  className = 'btn-primary',
  name,
  value,
  pendingText,
}: {
  children: ReactNode
  className?: string
  name?: string
  value?: string
  pendingText?: string
}) {
  const { pending, data } = useFormStatus()
  const mine = !name || data?.get(name) === value
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={className}>
      {pending && mine ? pendingText ?? 'Working…' : children}
    </button>
  )
}

export function Message({ state }: { state: ActionState }) {
  if (!state?.error && !state?.ok) return null
  return (
    <div
      role={state.error ? 'alert' : 'status'}
      className={clsx(
        'whitespace-pre-line rounded-lg px-3 py-2 text-sm',
        state.error ? 'bg-red-50 text-red-800 ring-1 ring-red-100' : 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100',
      )}
    >
      {state.error ?? state.ok}
    </div>
  )
}

/** Generic form wrapper around a server action with inline success / error feedback. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess = false,
}: {
  action: (state: ActionState, fd: FormData) => Promise<ActionState>
  children: ReactNode
  className?: string
  resetOnSuccess?: boolean
}) {
  const [state, formAction] = useActionState(action, undefined)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset()
  }, [state, resetOnSuccess])
  return (
    <form ref={ref} action={formAction} className={clsx('space-y-3', className)}>
      {children}
      <Message state={state} />
    </form>
  )
}
