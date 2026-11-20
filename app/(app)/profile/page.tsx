import type { Metadata } from 'next'
import { requireMe } from '@/lib/auth'
import { ActionForm, SubmitButton } from '@/components/forms'
import { Card, PageHeader } from '@/components/ui'
import { changePassword } from '@/app/actions'

export const metadata: Metadata = { title: 'Change password' }

export default async function ProfilePage() {
  const me = await requireMe()
  return (
    <div className="max-w-lg">
      <PageHeader title="Change password" subtitle={me.email} />
      <Card>
        <ActionForm action={changePassword} resetOnSuccess>
          <label className="block"><span className="label">New password</span><input name="password" type="password" minLength={8} required className="input" autoComplete="new-password" /></label>
          <label className="block"><span className="label">Confirm</span><input name="confirm" type="password" minLength={8} required className="input" autoComplete="new-password" /></label>
          <SubmitButton>Update password</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  )
}
