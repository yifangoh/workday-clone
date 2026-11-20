import type { Metadata } from 'next'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ClaimForm } from '@/components/ClaimForm'
import { Card, PageHeader } from '@/components/ui'
import { todaySG } from '@/lib/format'
import type { ClaimType } from '@/lib/types'

export const metadata: Metadata = { title: 'New expense report' }

export default async function NewClaimPage() {
  const me = await requireMe()
  const supabase = await createClient()
  const { data } = await supabase.from('claim_types').select('*').eq('is_active', true).order('sort_order')
  return (
    <div className="space-y-6">
      <PageHeader back={{ href: '/expenses', label: 'Expenses' }} title="Create expense report" subtitle="One report can hold several receipts. Every line needs a receipt number." />
      <Card>
        <ClaimForm types={(data ?? []) as ClaimType[]} today={todaySG()} approverName={me.manager?.full_name ?? 'your approver'} />
      </Card>
    </div>
  )
}
