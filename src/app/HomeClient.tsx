'use client'

import { useRouter } from 'next/navigation'
import { Landing } from '../screens/Landing'

/**
 * Client half of the home route. The page itself stays a Server Component so it
 * can export document metadata (#657); only the router wiring needs the client.
 */
export function HomeClient() {
  const router = useRouter()
  return (
    <Landing onConnect={() => router.push('/connect')} onExplore={() => router.push('/explore')} />
  )
}
