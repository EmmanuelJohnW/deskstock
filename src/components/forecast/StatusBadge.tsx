import { STATUS_LABEL } from '@/lib/forecast/format'
import type { ForecastStatus } from '@/lib/forecast/types'

const STATUS_CLS: Record<ForecastStatus, string> = {
  out_of_stock: 'bg-red-100 text-red-700',
  critical: 'bg-red-50 text-red-600',
  monitor: 'bg-orange-50 text-orange-600',
  ok: 'bg-emerald-50 text-emerald-700',
  no_usage: 'bg-gray-100 text-gray-500',
  insufficient_data: 'bg-gray-100 text-gray-500',
}

interface StatusBadgeProps {
  status: ForecastStatus
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  )
}
