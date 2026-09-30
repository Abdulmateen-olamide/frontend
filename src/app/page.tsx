import { HomeClient } from './HomeClient'
import { absoluteTitle } from '../lib/routeMetadata'
import { routeMetadata } from '../lib/routeMetadata.server'

/**
 * Home page metadata. It shares the root layout's route segment, where Next.js
 * doesn't apply `title.template`, so the brand suffix is composed explicitly
 * from the same constant every other route uses (#657).
 */
export async function generateMetadata() {
  const metadata = await routeMetadata('/')
  return {
    ...metadata,
    title: { absolute: absoluteTitle(String((metadata.title as { default: string }).default)) },
  }
}

export default function HomePage() {
  return <HomeClient />
}
