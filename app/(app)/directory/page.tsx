import type { Metadata } from 'next'
import Link from 'next/link'
import { requireMe } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Avatar, PageHeader } from '@/components/ui'
import type { Department, Employee } from '@/lib/types'

export const metadata: Metadata = { title: 'Directory' }

export default async function Directory({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireMe()
  const { q } = await searchParams
  const supabase = await createClient()
  let query = supabase.from('employees').select('*').eq('is_active', true).order('full_name')
  if (q) query = query.or(`full_name.ilike.%${q.replace(/[%,()]/g, '')}%,job_title.ilike.%${q.replace(/[%,()]/g, '')}%`)
  const [{ data: emps }, { data: depts }] = await Promise.all([query, supabase.from('departments').select('*').order('name')])
  const people = (emps ?? []) as Employee[]
  const departments = (depts ?? []) as Department[]
  return (
    <div>
      <PageHeader
        title="Directory"
        subtitle={`${people.length} people`}
        actions={
          <form>
            <input name="q" defaultValue={q} placeholder="Search name or title" className="input w-64" />
          </form>
        }
      />
      <div className="space-y-6">
        {departments.map((d) => {
          const members = people.filter((p) => p.department_id === d.id)
          if (!members.length) return null
          return (
            <section key={d.id}>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{d.name}</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {members.map((p) => (
                  <Link key={p.id} href={`/directory/${p.id}`} className="card flex items-center gap-3 p-4 transition hover:border-brand-200">
                    <Avatar name={p.full_name} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.full_name}</p>
                      <p className="truncate text-xs text-muted">{p.job_title}{d.head_id === p.id && ' · Head'}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
