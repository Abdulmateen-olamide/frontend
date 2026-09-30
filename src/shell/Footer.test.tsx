import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@/test/render'
import userEvent from '@testing-library/user-event'
import { Footer } from './Footer'
import { TelemetryConsent } from '../components/TelemetryConsent'
import { TELEMETRY_CONSENT_KEY, readTelemetryConsent } from '../lib/errorReporting'

describe('Footer privacy control (#658)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the trust links alongside the telemetry preference', () => {
    render(<Footer />)
    expect(screen.getByRole('navigation', { name: /trust links/i })).toBeInTheDocument()
    expect(screen.getByTestId('telemetry-preference')).toBeInTheDocument()
  })

  it('reopens the consent banner from the footer and records the choice', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Footer />
        <TelemetryConsent />
      </>,
    )

    await user.click(screen.getByTestId('telemetry-preference'))
    await user.click(await screen.findByRole('button', { name: /no thanks/i }))
    expect(localStorage.getItem(TELEMETRY_CONSENT_KEY)).toBe('denied')
    expect(readTelemetryConsent()).toBe('denied')
  })
})
