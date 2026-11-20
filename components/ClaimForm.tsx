'use client'

import { useActionState, useMemo, useState } from 'react'
import { Paperclip, Plus, Trash2 } from 'lucide-react'
import { submitClaim } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { Message, SubmitButton } from './forms'
import { money } from '@/lib/format'
import type { ClaimType } from '@/lib/types'

type Line = {
  key: number
  expense_date: string
  claim_type: string
  description: string
  amount: string
  receipt_no: string
  attachment_path?: string
  attachment_name?: string
  uploading?: boolean
}

let seq = 1

export function ClaimForm({ types, today, approverName }: { types: ClaimType[]; today: string; approverName: string }) {
  const [state, action] = useActionState(submitClaim, undefined)
  const blank = (): Line => ({ key: seq++, expense_date: today, claim_type: types[0]?.code ?? '', description: '', amount: '', receipt_no: '' })
  const [lines, setLines] = useState<Line[]>([blank()])
  const [uploadError, setUploadError] = useState('')
  const total = useMemo(() => lines.reduce((a, l) => a + (Number(l.amount) || 0), 0), [lines])
  const typeOf = (code: string) => types.find((t) => t.code === code)

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  async function upload(key: number, file: File) {
    setUploadError('')
    if (file.size > 5 * 1024 * 1024) return setUploadError('Receipts must be 5 MB or smaller.')
    update(key, { uploading: true })
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const path = `${user?.id}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, '_')}`
    const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type })
    if (error) {
      setUploadError(error.message)
      update(key, { uploading: false })
    } else update(key, { uploading: false, attachment_path: path, attachment_name: file.name })
  }

  const payload = JSON.stringify(
    lines.map(({ expense_date, claim_type, description, amount, receipt_no, attachment_path }) => ({
      expense_date, claim_type, description, amount: amount === '' ? null : Number(amount), receipt_no, attachment_path,
    })),
  )

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="lines" value={payload} />
      <label className="block max-w-xl">
        <span className="label">Report title</span>
        <input name="title" className="input" placeholder="e.g. Client site visit – Jurong (Nov)" required />
      </label>

      <div className="space-y-3">
        {lines.map((l, i) => {
          const t = typeOf(l.claim_type)
          const over = t?.per_line_limit != null && Number(l.amount) > t.per_line_limit
          return (
            <div key={l.key} className="rounded-xl border border-line p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold">Line {i + 1}</p>
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="text-muted hover:text-red-700" aria-label={`Remove line ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-6">
                <label className="sm:col-span-1">
                  <span className="label">Date</span>
                  <input type="date" max={today} value={l.expense_date} onChange={(e) => update(l.key, { expense_date: e.target.value })} className="input" />
                </label>
                <label className="sm:col-span-2">
                  <span className="label">Expense type</span>
                  <select value={l.claim_type} onChange={(e) => update(l.key, { claim_type: e.target.value })} className="input">
                    {types.map((ct) => (
                      <option key={ct.code} value={ct.code}>{ct.name}</option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-3">
                  <span className="label">Description</span>
                  <input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className="input" placeholder="What was it for?" />
                </label>
                <label className="sm:col-span-2">
                  <span className="label">Amount (SGD)</span>
                  <input type="number" inputMode="decimal" step="0.01" min="0" value={l.amount} onChange={(e) => update(l.key, { amount: e.target.value })} className="input" />
                  {t?.per_line_limit != null && (
                    <span className={`mt-1 block text-xs ${over ? 'font-medium text-amber-700' : 'text-muted'}`}>
                      {over ? `Above the ${money(t.per_line_limit)} guideline — will be flagged` : `Guideline ${money(t.per_line_limit)}`}
                    </span>
                  )}
                </label>
                <label className="sm:col-span-2">
                  <span className="label">Receipt no.{t?.receipt_required ? '' : ' (optional)'}</span>
                  <input value={l.receipt_no} onChange={(e) => update(l.key, { receipt_no: e.target.value })} className="input" placeholder="e.g. INV-55120" />
                </label>
                <div className="sm:col-span-2">
                  <span className="label">Attachment (optional)</span>
                  <label className="btn-secondary w-full cursor-pointer truncate">
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span className="truncate">{l.uploading ? 'Uploading…' : l.attachment_name ?? 'Attach receipt'}</span>
                    <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(l.key, e.target.files[0])} />
                  </label>
                </div>
              </div>
            </div>
          )
        })}
        <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="btn-secondary">
          <Plus className="h-4 w-4" /> Add line
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-canvas p-4">
        <p className="text-sm text-muted">{lines.length} line{lines.length === 1 ? '' : 's'}</p>
        <p className="text-lg font-semibold">Total {money(total)}</p>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="declaration" className="mt-0.5 h-4 w-4 rounded border-line" />
        <span>I declare these expenses were incurred wholly for business, are supported by the receipts listed, and have not been claimed before.</span>
      </label>

      {uploadError && <Message state={{ error: uploadError }} />}
      <Message state={state} />
      <div className="flex items-center gap-3">
        <SubmitButton pendingText="Submitting…">Submit claim</SubmitButton>
        <span className="text-xs text-muted">Goes to {approverName} for approval, then to Finance</span>
      </div>
    </form>
  )
}
