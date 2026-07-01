import {
  Cpu,
  Layers,
  Lightbulb,
  Minus,
  Package,
  Radio,
  Zap,
  type LucideIcon,
} from 'lucide-react'

const HEX_CLIP = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)'

const ICON_RULES: Array<{ pattern: RegExp; icon: LucideIcon }> = [
  { pattern: /Ω|ohm|resistor/i,                              icon: Minus     },
  { pattern: /[nµ]F|pF|capacitor/i,                         icon: Layers    },
  { pattern: /LED/i,                                         icon: Lightbulb },
  { pattern: /ATtiny|ATmega|ESP\d|PIC\d|MCU|Tiny\d|mega\d/i, icon: Cpu      },
  { pattern: /1N\d+|diode/i,                                 icon: Zap       },
  { pattern: /[µm]H|inductor/i,                              icon: Radio     },
  { pattern: /HC-SR|sensor|module/i,                         icon: Radio     },
]

function resolveIcon(component: string): LucideIcon {
  for (const { pattern, icon } of ICON_RULES) {
    if (pattern.test(component)) return icon
  }
  return Package
}

interface HexBinProps {
  idx: number
  component: string
  count: number
  isReject: boolean
  isEmpty: boolean
}

export function HexBin({ idx, component, count, isReject, isEmpty }: HexBinProps) {
  const Icon = isEmpty || isReject ? Package : resolveIcon(component)

  const bg = isEmpty
    ? '#e2e5ea'
    : isReject
    ? 'linear-gradient(160deg, #fff1f2 0%, #fecdd3 100%)'
    : 'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)'

  const accentColor = isEmpty ? '#9ca3af' : isReject ? '#e11d48' : '#059669'
  const labelColor = '#9ca3af'
  const binLabel = isReject ? 'REJECT' : `BIN ${idx}`
  const binLabelColor = isEmpty ? '#9ca3af' : isReject ? '#fda4af' : '#d1d5db'
  const displayComponent = isEmpty ? 'Empty' : component

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center select-none box-border"
      style={{
        clipPath: HEX_CLIP,
        background: bg,
        border: isEmpty ? '1px solid #c4c9d2' : 'none',
      }}
    >
      <Icon
        style={{
          color: accentColor,
          width: 'clamp(9px, 2cqw, 15px)',
          height: 'clamp(9px, 2cqw, 15px)',
          flexShrink: 0,
        }}
      />

      <span
        className="font-mono font-bold tabular-nums leading-none mt-1"
        style={{ fontSize: 'clamp(12px, 2.9cqw, 22px)', color: accentColor }}
      >
        {count}
      </span>

      <span
        className="text-center leading-tight"
        style={{
          fontSize: 'clamp(7px, 1.2cqw, 9px)',
          color: labelColor,
          padding: '0 22%',
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayComponent}
      </span>

      <span
        className="font-mono"
        style={{ fontSize: 'clamp(6px, 1.05cqw, 8px)', color: binLabelColor, marginTop: 1 }}
      >
        {binLabel}
      </span>
    </div>
  )
}
