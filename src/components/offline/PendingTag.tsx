/** Marks a row or value that includes changes saved offline and not yet synced. */
export function PendingTag() {
  return (
    <span
      title="Saved on this laptop; will sync automatically"
      className="ml-2 inline-block rounded bg-amber-100 px-1.5 py-0.5 align-middle font-sans text-[10px] font-semibold uppercase tracking-wide text-amber-700"
    >
      Pending sync
    </span>
  )
}

interface ActionNoticeProps {
  queued: boolean
  message: string
}

/** Feedback after a form action: synced, or saved offline. */
export function ActionNotice({ queued, message }: ActionNoticeProps) {
  return (
    <p className={`mt-3 text-sm ${queued ? 'text-amber-700' : 'text-gray-500'}`}>
      {message}
      {queued && ' Saved on this laptop; it will sync automatically.'}
    </p>
  )
}
