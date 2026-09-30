import { HomeClient } from './HomeClient'
import { routeMetadata } from '../lib/routeMetadata.server'

/** The home page carries the site's own title, via the root layout's template (#657). */
export async function generateMetadata() {
  return routeMetadata('/')
}

export default function HomePage() {
  return <HomeClient />
}
