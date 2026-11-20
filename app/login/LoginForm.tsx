'use client'

import { useActionState } from 'react'
import { signIn } from '@/app/actions'
import { Message, SubmitButton } from '@/components/forms'

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, undefined)
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="label">Email</span>
        <input name="email" type="email" required autoComplete="email" className="input" placeholder="you@company.com" />
      </label>
      <label className="block">
        <span className="label">Password</span>
        <input name="password" type="password" required autoComplete="current-password" className="input" />
      </label>
      <Message state={state} />
      <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
    </form>
  )
}
