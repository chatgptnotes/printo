import type { Metadata, Viewport } from 'next'
import './globals.css'

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'ERP Realsoft - AI BOQ and MEP Estimation',
    template: '%s | ERP Realsoft',
  },
  description:
    'Turn drawings, schedules, specifications, and RFQ emails into reviewed Bills of Quantities with AI extraction and estimator approval.',
  applicationName: 'ERP Realsoft',
  keywords: [
    'MEP estimation software',
    'BOQ software Dubai',
    'RFQ to BOQ',
    'electrical BOQ automation',
    'Bill of Quantities generator',
    'MEP estimating UAE',
    'cable schedule automation',
    'construction estimating Dubai',
  ],
  authors: [{ name: 'ERP Realsoft' }],
  creator: 'ERP Realsoft',
  alternates: {
    canonical: '/',
    languages: {
      'en-AE': '/',
      'x-default': '/',
    },
  },
  robots: { index: true, follow: true },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-icon.png' }],
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'ERP Realsoft',
    title: 'ERP Realsoft - Automated MEP Estimation and BOQ Software',
    description:
      'From RFQ email to a priced MEP Bill of Quantities in hours. Electrical, HVAC, plumbing & fire estimation for Dubai, UAE contractors.',
    locale: 'en_US',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ERP Realsoft - From RFQ Email to BOQ Quotation, Automated',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ERP Realsoft - Automated MEP Estimation and BOQ Software',
    description:
      'From RFQ email to a priced MEP Bill of Quantities in hours. Built for Dubai, UAE contractors.',
    images: ['/og-image.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
