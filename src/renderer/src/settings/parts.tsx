import type { ReactNode } from 'react'
import { Switch } from '@/components'

/** One page of Settings: a title, an optional sentence, then its rows. */
export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-3 px-4 py-4">
      <div>
        <h3 className="text-[13px] font-semibold text-ink-0">{title}</h3>
        {description && <p className="mt-0.5 text-[12px] text-pretty text-ink-2">{description}</p>}
      </div>
      {children}
    </section>
  )
}

/** A label (and a hint under it) on the left, its control on the right. */
export function Row({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{label}</div>
        {hint && <div className="text-[11px] text-pretty text-ink-2">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

export function SwitchRow(props: { label: string; description: string; checked: boolean; onChange(on: boolean): void }): ReactNode {
  return (
    <label className="flex cursor-pointer items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{props.label}</div>
        <p className="mt-0.5 text-[11px] text-pretty text-ink-2">{props.description}</p>
      </div>
      <Switch label={props.label} checked={props.checked} onChange={props.onChange} className="mt-0.5" />
    </label>
  )
}
