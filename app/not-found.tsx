import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="text-2xl font-semibold">Not found, or not yours to see</h1>
      <p className="max-w-md text-sm text-muted">The record may not exist, or your role doesn&apos;t give you access to it.</p>
      <Link href="/" className="btn-primary mt-2">Back to Home</Link>
    </main>
  )
}
