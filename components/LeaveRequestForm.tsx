'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { submitLeave } from '@/app/actions'
import { createClient } from '@/lib/supabase/client'
import { Message, SubmitButton } from './forms'
import { days, fmtRange, num } from '@/lib/format'
import type { LeavePreview, LeaveType } from '@/lib/types'

export function LeaveRequestForm({ types, today, approverName }: { types: LeaveType[]; today: string; approverName: string }) {
  const [state, action] = useActionState(submitLeave, undefined)
  const [type, setType] = useState(types[0]?.code ?? 'AL')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [half, setHalf] = useState<'none' | 'am' | 'pm'>('none')
  const [doc, setDoc] = useState('')
  const [preview, setPreview] = useState<LeavePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const lt = useMemo(() => types.find((t) => t.code === type), [types, type])
  const effectiveEnd = end || start
  const single = !!start && start === effectiveEnd

  useEffect(() => {
    if (!start) {
      setPreview(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      const { data, error } = await createClient().rpc('preview_leave', {
        p_type: type,
        p_start: start,
        p_end: effectiveEnd,
        p_half: single ? half : 'none',
        p_document: doc || null,
      })
      if (!cancelled) {
        setPreview(error ? { errors: [error.message], flags: [], days: 0, clashes: [] } : (data as LeavePreview))
        setLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [type, start, effectiveEnd, half, doc, single])

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset()
      setStart('')
      setEnd('')
      setHalf('none')
      setDoc('')
      setPreview(null)
    }
  }, [state])

  const blocked = !!preview?.errors?.length

  return (
    <form ref={formRef} action={action} className="grid gap-6 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <label className="block">
          <span className="label">Type</span>
          <select name="leave_type" value={type} onChange={(e) => setType(e.target.value)} className="input">
            {types.map((t) => (
              <option key={t.code} value={t.code}>{t.name}</option>
            ))}
          </select>
          {lt && (
            <span className="mt-1 block text-xs text-muted">
              {[
                lt.tracks_balance ? `${num(lt.default_days)} days a year` : 'No balance; only after annual leave is used up',
                lt.requires_document && `needs ${lt.document_label}`,
                lt.min_notice_days > 0 && `${lt.min_notice_days} days' notice recommended`,
                lt.allow_backdate && 'can be applied after the fact',
                lt.counts_toward && 'counts toward the hospitalisation cap',
              ].filter(Boolean).join(' · ')}
            </span>
          )}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">From</span>
            <input
              type="date"
              name="start_date"
              required
              value={start}
              min={lt?.allow_backdate ? undefined : today}
              onChange={(e) => {
                setStart(e.target.value)
                if (!end || end < e.target.value) setEnd(e.target.value)
              }}
              className="input"
            />
          </label>
          <label className="block">
            <span className="label">To</span>
            <input type="date" name="end_date" required value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className="input" />
          </label>
        </div>
        {single && lt?.allow_half_day && (
          <fieldset>
            <span className="label">Duration</span>
            <div className="flex flex-wrap gap-2">
              {(['none', 'am', 'pm'] as const).map((h) => (
                <label key={h} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${half === h ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line'}`}>
                  <input type="radio" name="half_day" value={h} checked={half === h} onChange={() => setHalf(h)} className="sr-only" />
                  {h === 'none' ? 'Full day' : h === 'am' ? 'Half day · AM' : 'Half day · PM'}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {!single && <input type="hidden" name="half_day" value="none" />}
        {lt?.requires_document && (
          <label className="block">
            <span className="label">{lt.document_label?.replace(/^(an?|the)\s+/i, '')}</span>
            <input name="document_ref" value={doc} onChange={(e) => setDoc(e.target.value)} className="input" placeholder="e.g. MC-20261120-0001" required />
          </label>
        )}
        <label className="block">
          <span className="label">Reason / comment (optional)</span>
          <textarea name="reason" rows={3} className="input" placeholder="Anything your approver should know" />
        </label>
        <Message state={state} />
        {state?.id && (
          <Link href={`/time-off/${state.id}`} className="link text-sm">View request →</Link>
        )}
        <div className="flex items-center gap-3">
          <SubmitButton pendingText="Submitting…">Submit request</SubmitButton>
          <span className="text-xs text-muted">Goes to {approverName} for approval</span>
        </div>
      </div>

      <aside className="lg:col-span-2">
        <div className="sticky top-20 rounded-xl border border-line bg-canvas p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Check before you submit</p>
          {!start ? (
            <p className="mt-3 text-sm text-muted">Pick your dates to see working days, your balance after this request and any team clashes.</p>
          ) : loading && !preview ? (
            <p className="mt-3 text-sm text-muted">Checking…</p>
          ) : preview ? (
            <div className={`mt-3 space-y-3 ${loading ? 'opacity-60' : ''}`}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-muted">Working days</p>
                  <p className="text-xl font-semibold">{num(preview.days)}</p>
                  <p className="text-[11px] text-muted">excl. weekends & public holidays</p>
                </div>
                <div className="rounded-lg bg-white p-3">
                  <p className="text-xs text-muted">Balance after</p>
                  <p className={`text-xl font-semibold ${preview.balance_after != null && preview.balance_after < 0 ? 'text-red-700' : ''}`}>
                    {preview.tracks_balance && preview.balance_after != null ? num(preview.balance_after) : '—'}
                  </p>
                  <p className="text-[11px] text-muted">
                    {preview.tracks_balance && preview.balance_before != null ? `${num(preview.balance_before)} available now` : 'not tracked'}
                  </p>
                </div>
              </div>
              {blocked ? (
                <ul className="space-y-1.5">
                  {preview.errors.map((e) => (
                    <li key={e} className="flex gap-2 rounded-lg bg-red-50 p-2 text-sm text-red-800">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {e}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex gap-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Ready to submit · {days(preview.days)}
                </p>
              )}
              {preview.flags.length > 0 && (
                <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                  <p className="font-medium">Your approver will see: {preview.flags.join(', ')}</p>
                  {preview.clashes.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {preview.clashes.map((c) => (
                        <li key={c.ref}>{c.name} · {fmtRange(c.start_date, c.end_date)} ({c.status})</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </form>
  )
}
