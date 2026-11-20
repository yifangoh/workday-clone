import { Tabs } from './ui'

export function HrTabs({ active }: { active: string }) {
  return (
    <Tabs
      active={active}
      tabs={[
        { href: '/hr', label: 'Overview & monthly report' },
        { href: '/hr/master-leave-record', label: 'Master Leave Record' },
        { href: '/hr/requests', label: 'All leave requests' },
        { href: '/hr/setup', label: 'Staff, entitlements & holidays' },
      ]}
    />
  )
}
