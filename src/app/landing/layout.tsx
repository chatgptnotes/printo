import type { Metadata } from 'next'
import { faqs } from './faqs'

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001'

export const metadata: Metadata = {
  // absolute = bypass the "%s | ERP Realsoft" template so the title stays 50–60 chars
  title: { absolute: 'RFQ to BOQ in Hours — ERP Realsoft MEP Estimation, Dubai' },
  description:
    'RFQ to BOQ in hours: ERP Realsoft AI reads RFQ emails, scans drawings and builds a priced Excel MEP BOQ — electrical, HVAC, plumbing & fire. Dubai, UAE.',
  alternates: {
    canonical: '/landing',
    languages: {
      'en-AE': '/landing',
      'x-default': '/landing',
    },
  },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/landing`,
    siteName: 'ERP Realsoft',
    title: 'RFQ to BOQ in Hours — Automated MEP Estimation Pipeline',
    description:
      'From RFQ email to a priced MEP Bill of Quantities in days. Built for Dubai, UAE contractors.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'ERP Realsoft — From RFQ Email to BOQ Quotation, Automated',
      },
    ],
  },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'SoftwareApplication',
      name: 'ERP Realsoft',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'Automated MEP estimation pipeline that turns RFQ emails and drawings into a priced Bill of Quantities for electrical, HVAC, plumbing and fire-fighting works.',
      url: SITE_URL,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'AED' },
      areaServed: { '@type': 'Country', name: 'United Arab Emirates' },
    },
    {
      '@type': 'Organization',
      name: 'ERP Realsoft',
      alternateName: 'ERP Realsoft',
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
      areaServed: 'AE',
      contactPoint: {
        '@type': 'ContactPoint',
        email: 'info@realsoft.example',
        contactType: 'sales',
        areaServed: 'AE',
      },
    },
    {
      '@type': 'LocalBusiness',
      name: 'ERP Realsoft',
      image: `${SITE_URL}/og-image.png`,
      url: SITE_URL,
      email: 'info@realsoft.example',
      areaServed: { '@type': 'Country', name: 'United Arab Emirates' },
      address: {
        '@type': 'PostalAddress',
        streetAddress:
          'Company address to be configured before production launch',
        addressLocality: 'Dubai',
        addressCountry: 'AE',
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    },
  ],
}

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      {children}
    </>
  )
}
