import { type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import PropTypes from 'prop-types'

/**
 * Heliobond Badge — a small status marker. Tones derive meaning from an
 * ink-colored label + optional glyph; solar never carries meaning alone.
 * Use `tone="testnet"` for the loud, unmissable network badge.
 */
export type BadgeTone = 'neutral' | 'solar' | 'growth' | 'ember' | 'testnet'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** Visual theme/color tone of the badge marker. Defaults to 'neutral'. */
  tone?: BadgeTone
  /** Optional icon node displayed preceding the badge label. */
  icon?: ReactNode
  /** Badge text label or content. */
  children: ReactNode
}

export function Badge({ tone = 'neutral', icon = null, children, style, ...rest }: BadgeProps) {
  const tones: Record<BadgeTone, CSSProperties> = {
    neutral: {
      background: 'var(--ink-06)',
      color: 'var(--ink-strong, #1a1a1a)',
      border: '1px solid var(--ink-12)',
    },
    solar: {
      background: 'var(--solar-12)',
      color: 'var(--ink-strong, #1a1a1a)',
      border: '1px solid var(--solar-24)',
    },
    growth: {
      background: 'color-mix(in srgb, var(--growth-strong, #0b6e45) 12%, white)',
      color: 'var(--ink-strong, #1a1a1a)',
      border: '1px solid var(--growth-strong, #0b6e45)',
    },
    ember: {
      background: 'var(--ember-12)',
      color: 'var(--ink-strong, #1a1a1a)',
      border: '1px solid var(--ember-strong, #b45309)',
    },
    testnet: {
      background: 'var(--solar)',
      color: 'var(--ink-strong, #1a1a1a)',
      border: '1px solid transparent',
    },
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 24,
        padding: '0 10px',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        fontSize: 'var(--type-caption)',
        letterSpacing: tone === 'testnet' ? '0.04em' : 0,
        textTransform: tone === 'testnet' ? 'uppercase' : 'none',
        borderRadius: 'var(--radius-pill)',
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...style,
      }}
      {...rest}
    >
      {icon}
      {children}
    </span>
  )
}

Badge.propTypes = {
  tone: PropTypes.oneOf(['neutral', 'solar', 'growth', 'ember', 'testnet']),
  icon: PropTypes.node,
  children: PropTypes.node.isRequired,
  style: PropTypes.object,
}
