import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/admin',
        '/bids',
        '/inbox',
        '/analytics',
        '/clients',
        '/documents',
        '/drawing-ai',
        '/keywords',
        '/price-library',
        '/projects',
        '/settings',
        '/team',
        '/yardstick',
        '/calendar',
        '/viewer',
        '/auth/',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
