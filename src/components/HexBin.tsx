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
  if (isEmpty) {
    return (
      <div
        className="w-full h-full opacity-60"
        style={{ clipPath: HEX_CLIP, background: '#f3f4f6' }}
      />
    )
  }

  const Icon = isReject ? Package : resolveIcon(component)

  const bg = isReject
    ? 'linear-gradient(160deg, #fff1f2 0%, #fecdd3 100%)'
    : 'linear-gradient(160deg, #ecfdf5 0%, #d1fae5 100%)'

  const iconColor  = isReject ? '#e11d48' : '#059669'
  const countColor = isReject ? '#e11d48' : '#059669'
  const labelColor = '#9ca3af'
  const binLabel   = isReject ? 'REJECT' : `BIN ${idx}`
  const binLabelColor = isReject ? '#fda4af' : '#d1d5db'

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center select-none"
      style={{ clipPath: HEX_CLIP, background: bg }}
    >
      <Icon style={{ color: iconColor, width: 15, height: 15, flexShrink: 0 }} />

      <span
        className="font-mono font-bold tabular-nums leading-none mt-1"
        style={{ fontSize: 22, color: countColor }}
      >
        {count}
      </span>

      <span
        className="text-center leading-tight"
        style={{
          fontSize: 9,
          color: labelColor,
          padding: '0 22%',
          width: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {component}
      </span>

      <span
        className="font-mono"
        style={{ fontSize: 8, color: binLabelColor, marginTop: 1 }}
      >
        {binLabel}
      </span>
    </div>
  )
}
