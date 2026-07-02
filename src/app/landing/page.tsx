'use client';

import Link from 'next/link';
import { faqs } from './faqs';
import {
  Mail,
  Zap,
  FileSpreadsheet,
  CheckCircle2,
  ArrowRight,
  Building2,
  Thermometer,
  Droplets,
  Flame,
  BrainCircuit,
  BarChart3,
  Shield,
  Clock,
  TrendingUp,
  MapPin,
  Phone,
  Globe,
  ChevronRight,
  Star,
  Layers,
  FileSearch,
  ScanLine,
  Calculator,
  SendHorizonal,
  ListChecks,
  FolderOpen,
  Cpu,
} from 'lucide-react';

const pipelineSteps = [
  {
    number: '01',
    title: 'Monitor Inbox',
    description: 'Continuously watches your configured inbox for incoming RFQ emails from clients and consultants.',
    icon: Mail,
    color: 'from-blue-500 to-blue-600',
    tag: 'Automated',
  },
  {
    number: '02',
    title: 'AI Classification',
    description: 'Classifies each email as an RFQ and assigns priority (Top, High, Medium, Low) based on client and deadline signals.',
    icon: BrainCircuit,
    color: 'from-violet-500 to-violet-600',
    tag: 'AI-Powered',
  },
  {
    number: '03',
    title: 'Auto Bid List Entry',
    description: 'Automatically creates a bid entry and adds the project to the active bid list — no manual data entry needed.',
    icon: ListChecks,
    color: 'from-indigo-500 to-indigo-600',
    tag: 'Automated',
  },
  {
    number: '04',
    title: 'Project Extraction',
    description: 'Extracts key project details: number of floors, built-up area, ceiling heights, location, and project type.',
    icon: FileSearch,
    color: 'from-sky-500 to-sky-600',
    tag: 'AI-Powered',
  },
  {
    number: '05',
    title: 'Attachment Processing',
    description: 'Unzips archives, inventories drawing files, and identifies drawing types — architectural, structural, MEP.',
    icon: FolderOpen,
    color: 'from-cyan-500 to-cyan-600',
    tag: 'Automated',
  },
  {
    number: '06',
    title: 'MEP Services Scope',
    description: 'Identifies which MEP services to price: HVAC, Electrical, Plumbing, Fire Fighting, BMS, and more.',
    icon: ScanLine,
    color: 'from-teal-500 to-teal-600',
    tag: 'AI-Powered',
  },
  {
    number: '07',
    title: 'Estimation Engine',
    description: 'Calculates thermal loads, AC tonnage, duct sizing, pipe schedules, and equipment counts using formula-based models.',
    icon: Calculator,
    color: 'from-emerald-500 to-emerald-600',
    tag: 'Engineering',
  },
  {
    number: '08',
    title: 'Yardstick Check',
    description: 'Validates estimates against market rates (AED/sqft) for Dubai and UAE to ensure competitiveness and accuracy.',
    icon: BarChart3,
    color: 'from-amber-500 to-amber-600',
    tag: 'Validation',
  },
  {
    number: '09',
    title: 'BOQ Generation & Dispatch',
    description: 'Generates a formatted Excel BOQ with line items, quantities, rates, and totals — sent after approval.',
    icon: SendHorizonal,
    color: 'from-orange-500 to-rose-500',
    tag: 'Output',
  },
];

const features = [
  {
    icon: Thermometer,
    title: 'HVAC Load Calculations',
    description: 'Accurate thermal load analysis using ASHRAE methods for Dubai climate. Auto-calculates tonnage, AHU sizes, and chiller requirements.',
  },
  {
    icon: Zap,
    title: 'Electrical Estimation',
    description: 'Load schedules, cable sizing, panel boards, and MDB/SMDB counts based on occupancy and floor area.',
  },
  {
    icon: Droplets,
    title: 'Plumbing & Drainage',
    description: 'Fixture counts, pipe schedules, pump sizing, and tank capacities calculated from building parameters.',
  },
  {
    icon: Flame,
    title: 'Fire Fighting Systems',
    description: 'Sprinkler counts, hydrant systems, FM200 rooms, and fire pump packages priced by area and occupancy type.',
  },
  {
    icon: Shield,
    title: 'Yardstick Validation',
    description: 'Every estimate is benchmarked against current UAE market rates to flag outliers before submission.',
  },
  {
    icon: Cpu,
    title: 'Formula-Based Accuracy',
    description: 'Deterministic engineering formulas ensure consistency — not black-box AI guesses. Every number is traceable.',
  },
];

const stats = [
  { value: '2 weeks', label: 'Average manual estimation time', arrow: true },
  { value: '2 days', label: 'With ERP Realsoft', arrow: false },
  { value: '95%', label: 'Estimation accuracy vs. final BOQ', arrow: false },
  { value: '3,000%', label: 'Return on investment', arrow: false },
];

const services = [
  { name: 'HVAC & Mechanical', icon: Thermometer },
  { name: 'Electrical', icon: Zap },
  { name: 'Plumbing & Drainage', icon: Droplets },
  { name: 'Fire Fighting', icon: Flame },
  { name: 'BMS Integration', icon: Cpu },
  { name: 'ELV Systems', icon: Layers },
];

export default function LandingPage() {
  return (
    <div className="landing-overflow min-h-screen bg-[#060d1f] text-white">

      {/* ─── NAVBAR ─── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#060d1f]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/50">
                <Building2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight text-white">ERP Realsoft</span>
                <span className="text-xs text-blue-400 ml-2 hidden sm:inline">realsoft.example</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="#pipeline"
                className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors"
              >
                Pipeline
              </a>
              <a
                href="#features"
                className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors mx-4"
              >
                Features
              </a>
              <Link
                href="/auth/login"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-all duration-200 hover:shadow-lg hover:shadow-blue-900/50"
              >
                Sign In
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative min-h-screen flex items-center pt-16 overflow-hidden">
        {/* Background radial gradients */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-blue-600/10 rounded-full blur-[120px]" />
          <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-violet-600/8 rounded-full blur-[100px]" />
          <div className="absolute bottom-1/4 right-1/4 w-[300px] h-[300px] bg-teal-500/8 rounded-full blur-[80px]" />
          {/* Grid pattern */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-32">
          <div className="max-w-4xl mx-auto text-center">
            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 text-xs font-semibold tracking-wide mb-8 opacity-0 animate-fade-in-up"
              style={{ animationFillMode: 'forwards' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              MEP ESTIMATION AUTOMATION — DUBAI, UAE
            </div>

            {/* Headline */}
            <h1
              className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-extrabold leading-[1.1] tracking-tight mb-6 opacity-0 animate-fade-in-up animation-delay-200"
              style={{ animationFillMode: 'forwards' }}
            >
              From RFQ Email to
              <br />
              <span className="gradient-text">BOQ Quotation</span>
              <br />
              <span className="text-gray-200">— Automated.</span>
            </h1>

            {/* Subheadline */}
            <p
              className="text-lg sm:text-xl text-gray-400 leading-relaxed max-w-2xl mx-auto mb-10 opacity-0 animate-fade-in-up animation-delay-400"
              style={{ animationFillMode: 'forwards' }}
            >
              ERP Realsoft&apos;s 23-step AI pipeline monitors your inbox, classifies RFQs, extracts project data,
              calculates MEP loads, and generates a ready-to-send Excel BOQ — in hours, not weeks.
            </p>

            {/* CTA Buttons */}
            <div
              className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16 opacity-0 animate-fade-in-up animation-delay-600"
              style={{ animationFillMode: 'forwards' }}
            >
              <Link
                href="/auth/login"
                className="group flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-8 py-4 rounded-xl text-base transition-all duration-200 hover:shadow-xl hover:shadow-blue-900/50 hover:-translate-y-0.5"
              >
                Access Your Pipeline
                <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href="#pipeline"
                className="flex items-center gap-2 text-gray-300 hover:text-white font-semibold px-8 py-4 rounded-xl text-base border border-white/10 hover:border-white/20 transition-all duration-200"
              >
                See How It Works
              </a>
            </div>

            {/* Hero illustration — Drawing → BOQ */}
            <div
              className="mb-16 opacity-0 animate-fade-in-up animation-delay-700 max-w-5xl mx-auto"
              style={{ animationFillMode: 'forwards' }}
            >
              <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-blue-950/50 bg-[#0f172a]">
                <img
                  src="/drawing-to-boq-hero.svg"
                  alt="ERP Realsoft transforms MEP drawings into a priced Bill of Quantities using AI"
                  className="w-full h-auto block"
                  width={900}
                  height={480}
                  loading="eager"
                  fetchPriority="high"
                />
              </div>
            </div>

            {/* Stats Bar */}
            <div
              className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-white/5 rounded-2xl overflow-hidden border border-white/5 opacity-0 animate-fade-in-up animation-delay-800"
              style={{ animationFillMode: 'forwards' }}
            >
              {[
                { label: 'Estimation Time', before: '2 weeks', after: '2 days', improvement: '7x faster' },
                { label: 'Accuracy Rate', value: '95%', sub: 'vs. final BOQ' },
                { label: 'Cost Reduction', value: '80%', sub: 'estimation overhead' },
                { label: 'ROI', value: '3,000%', sub: 'return on investment' },
              ].map((stat, i) => (
                <div key={i} className="bg-[#0a1628]/60 px-4 py-5 text-center">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{stat.label}</p>
                  {'before' in stat ? (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-gray-500 line-through text-sm">{stat.before}</span>
                      <ArrowRight className="h-3 w-3 text-blue-400" />
                      <span className="text-xl font-bold text-emerald-400">{stat.after}</span>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-blue-300">{stat.value}</p>
                  )}
                  {'sub' in stat && <p className="text-xs text-gray-500 mt-1">{stat.sub}</p>}
                  {'improvement' in stat && <p className="text-xs text-emerald-500 mt-1">{stat.improvement}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-50">
          <div className="w-px h-12 bg-gradient-to-b from-transparent to-blue-400" />
          <span className="text-xs text-gray-500 tracking-widest uppercase">Scroll</span>
        </div>
      </section>

      {/* ─── PIPELINE SECTION ─── */}
      <section id="pipeline" className="py-24 lg:py-32 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 right-0 w-[500px] h-[500px] bg-violet-600/5 rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section header */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-xs font-semibold tracking-wide mb-4">
              THE 23-STEP PIPELINE
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4">
              Every RFQ, fully processed
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              From the moment an email lands in your inbox to a formatted BOQ ready for the client —
              the entire pipeline runs automatically.
            </p>
          </div>

          {/* Pipeline grid — 3 columns on desktop */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {pipelineSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div
                  key={step.number}
                  className="group relative glass-card rounded-2xl p-6 hover:border-white/20 transition-all duration-300 hover:-translate-y-1 hover:glow-blue"
                  style={{
                    opacity: 0,
                    animation: `fadeInUp 0.6s ease-out ${index * 80}ms forwards`,
                  }}
                >
                  {/* Step number background */}
                  <div className="absolute top-4 right-4 text-5xl font-black text-white/[0.03] select-none">
                    {step.number}
                  </div>

                  {/* Icon */}
                  <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${step.color} mb-4 shadow-lg`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>

                  {/* Tag */}
                  <span className="inline-block text-[10px] font-bold tracking-wider uppercase text-blue-400/80 bg-blue-400/10 px-2 py-0.5 rounded-full mb-3">
                    {step.tag}
                  </span>

                  <h3 className="text-base font-bold text-white mb-2">
                    <span className="text-gray-500 mr-2 text-sm font-normal">Step {step.number}</span>
                    {step.title}
                  </h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{step.description}</p>

                  {/* Connector arrow (not on last item) */}
                  {index < pipelineSteps.length - 1 && index % 3 !== 2 && (
                    <div className="hidden lg:block absolute -right-2.5 top-1/2 -translate-y-1/2 z-10">
                      <ChevronRight className="h-5 w-5 text-blue-500/40" />
                    </div>
                  )}
                </div>
              );
            })}

            {/* Final output card */}
            <div className="md:col-span-2 lg:col-span-3 mt-2">
              <div className="relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-900/20 to-teal-900/20 p-8 text-center">
                <div className="absolute inset-0 bg-gradient-to-r from-emerald-600/5 to-teal-600/5" />
                <div className="relative">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 mb-4 shadow-xl shadow-emerald-900/50">
                    <FileSpreadsheet className="h-8 w-8 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Excel BOQ Delivered</h3>
                  <p className="text-gray-400 max-w-lg mx-auto text-sm">
                    A complete, formatted Bill of Quantities with MEP line items, quantities, unit rates in AED,
                    and project totals — ready for client submission after your one-click approval.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── MEP SERVICES ─── */}
      <section className="py-20 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/4 w-[600px] h-[400px] bg-blue-600/6 rounded-full blur-[100px]" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-teal-500/30 bg-teal-500/10 text-teal-300 text-xs font-semibold tracking-wide mb-4">
              MEP DISCIPLINES
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-3">
              All MEP Trades. One Pipeline.
            </h2>
            <p className="text-gray-400 text-base max-w-xl mx-auto">
              ERP Realsoft prices every MEP service discipline in a single automated run.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {services.map((service, i) => {
              const Icon = service.icon;
              return (
                <div
                  key={service.name}
                  className="glass-card rounded-xl p-5 text-center hover:border-blue-500/30 transition-all duration-300 hover:-translate-y-1 group"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-500/15 flex items-center justify-center mx-auto mb-3 group-hover:bg-blue-500/25 transition-colors">
                    <Icon className="h-5 w-5 text-blue-400" />
                  </div>
                  <p className="text-xs font-semibold text-gray-300">{service.name}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── FEATURES SECTION ─── */}
      <section id="features" className="py-24 lg:py-32 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300 text-xs font-semibold tracking-wide mb-4">
              ENGINEERING-GRADE
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4">
              Built for MEP professionals
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Not a generic AI tool. ERP Realsoft&apos;s pipeline is engineered specifically for MEP contracting in the UAE market.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="glass-card rounded-2xl p-6 hover:border-white/20 transition-all duration-300 group"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/20 border border-blue-500/20 flex items-center justify-center group-hover:from-blue-500/30 group-hover:to-blue-600/30 transition-all">
                      <Icon className="h-5 w-5 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white mb-1.5">{feature.title}</h3>
                      <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS / COMPARISON ─── */}
      <section className="py-24 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] bg-amber-500/5 rounded-full blur-[80px]" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            {/* Left: before/after */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-semibold tracking-wide mb-6">
                BEFORE vs AFTER
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-6">
                Stop losing bids to
                <span className="gradient-text"> slow turnarounds</span>
              </h2>
              <p className="text-gray-400 mb-8 leading-relaxed">
                In Dubai&apos;s competitive MEP market, speed wins bids. Every day of delay is a bid lost.
                ERP Realsoft compresses your estimation cycle from weeks to hours.
              </p>

              {/* Comparison table */}
              <div className="space-y-3">
                {[
                  { task: 'Inbox monitoring', before: 'Manual daily check', after: 'Real-time automated' },
                  { task: 'RFQ data entry', before: '30–60 min per RFQ', after: 'Instant extraction' },
                  { task: 'Drawing review', before: '2–4 hours', after: '< 5 minutes' },
                  { task: 'Load calculations', before: '2–3 days engineer time', after: '< 1 hour automated' },
                  { task: 'BOQ formatting', before: '4–8 hours', after: 'Auto-generated' },
                  { task: 'Market rate check', before: 'Experience-based guess', after: 'Yardstick database' },
                ].map((row, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                    <span className="text-gray-500 w-32 flex-shrink-0">{row.task}</span>
                    <span className="text-red-400/80 line-through flex-1">{row.before}</span>
                    <ArrowRight className="h-3 w-3 text-gray-600 flex-shrink-0" />
                    <span className="text-emerald-400 flex-1 text-right">{row.after}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: visual metric cards */}
            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  icon: Clock,
                  label: 'Estimation Cycle',
                  value: '2 days',
                  sub: 'down from 2 weeks',
                  color: 'blue',
                  gradient: 'from-blue-500 to-blue-600',
                },
                {
                  icon: TrendingUp,
                  label: 'More Bids Won',
                  value: '+40%',
                  sub: 'faster response = higher win rate',
                  color: 'emerald',
                  gradient: 'from-emerald-500 to-teal-600',
                },
                {
                  icon: Star,
                  label: 'Accuracy',
                  value: '95%',
                  sub: 'vs. manual estimation',
                  color: 'amber',
                  gradient: 'from-amber-500 to-orange-600',
                },
                {
                  icon: BarChart3,
                  label: 'Cost Savings',
                  value: '80%',
                  sub: 'reduction in estimation overhead',
                  color: 'violet',
                  gradient: 'from-violet-500 to-purple-600',
                },
              ].map((card, i) => {
                const Icon = card.icon;
                return (
                  <div
                    key={i}
                    className="glass-card rounded-2xl p-6 text-center hover:border-white/20 transition-all duration-300 hover:-translate-y-1"
                  >
                    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${card.gradient} mb-4 shadow-lg`}>
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <p className="text-3xl font-black text-white mb-1">{card.value}</p>
                    <p className="text-xs font-semibold text-gray-300 mb-1">{card.label}</p>
                    <p className="text-xs text-gray-500">{card.sub}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── FAQ SECTION ─── */}
      <section id="faq" className="py-24 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-blue-600/5 rounded-full blur-[100px]" />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 text-xs font-semibold tracking-wide mb-4">
              FREQUENTLY ASKED QUESTIONS
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4">
              MEP estimation, answered
            </h2>
            <p className="text-gray-400 text-lg max-w-2xl mx-auto">
              Everything contractors and consultants ask about automating the RFQ-to-BOQ
              workflow with ERP Realsoft in Dubai and the UAE.
            </p>
          </div>

          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <div key={i} className="glass-card rounded-2xl p-6 hover:border-white/20 transition-all duration-300">
                <h3 className="text-base sm:text-lg font-bold text-white mb-2">{faq.question}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA SECTION ─── */}
      <section className="py-24 relative">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-900/10 to-transparent" />
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="glass-card rounded-3xl p-12 lg:p-16 border border-blue-500/20 relative overflow-hidden">
            {/* Glow orb behind card */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-blue-600/10 rounded-full blur-[80px] pointer-events-none" />

            <div className="relative">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 mb-6 shadow-xl shadow-blue-900/50 animate-float">
                <Building2 className="h-8 w-8 text-white" />
              </div>

              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight mb-4">
                Ready to transform your
                <br />
                <span className="gradient-text">estimation workflow?</span>
              </h2>

              <p className="text-gray-400 text-lg max-w-2xl mx-auto mb-10">
                Join ERP Realsoft&apos;s automated pipeline and win more bids with faster, more accurate MEP quotations.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/auth/login"
                  className="group flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold px-10 py-4 rounded-xl text-base transition-all duration-200 hover:shadow-xl hover:shadow-blue-900/50 hover:-translate-y-0.5"
                >
                  Access the Pipeline
                  <ArrowRight className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <a
                  href="mailto:info@realsoft.example"
                  className="flex items-center gap-2 text-gray-300 hover:text-white font-semibold px-8 py-4 rounded-xl text-base border border-white/10 hover:border-white/20 transition-all duration-200"
                >
                  <Mail className="h-4 w-4" />
                  Contact Team
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-white/5 py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 mb-10">
            {/* Brand */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-900/50">
                  <Building2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <span className="text-base font-bold text-white">ERP Realsoft</span>
                </div>
              </div>
              <p className="text-sm text-gray-500 leading-relaxed">
                Mechanical, Electrical & Plumbing contracting services across the UAE.
                Powering modern buildings with expert MEP engineering.
              </p>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Contact</h4>
              <ul className="space-y-3">
                <li className="flex items-start gap-2 text-sm text-gray-500">
                  <Mail className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <a href="mailto:info@realsoft.example" className="hover:text-blue-300 transition-colors">
                    info@realsoft.example
                  </a>
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-500">
                  <Globe className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <a href="http://localhost:3001" className="hover:text-blue-300 transition-colors">
                    realsoft.example
                  </a>
                </li>
                <li className="flex items-start gap-2 text-sm text-gray-500">
                  <MapPin className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <span>
                    Company address to be configured<br />
                    before production launch.
                  </span>
                </li>
              </ul>
            </div>

            {/* Team */}
            <div>
              <h4 className="text-sm font-semibold text-white mb-4">Leadership</h4>
              <div className="glass-card rounded-xl p-4">
                <p className="text-sm font-semibold text-white">ERP Realsoft Administrator</p>
                <p className="text-xs text-blue-400 mb-2">Company Owner</p>
                <p className="text-xs text-gray-500">
                  Overseeing MEP estimation strategy and the RFQ-to-BOQ automation pipeline at ERP Realsoft.
                </p>
              </div>
              <div className="mt-3">
                <a
                  href="http://localhost:3001"
                  className="text-xs text-gray-500 hover:text-blue-300 transition-colors"
                >
                  realsoft.example
                </a>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="border-t border-white/5 pt-8 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-600">
              &copy; {new Date().getFullYear()} ERP Realsoft. All rights reserved.
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-600">
              <span>realsoft.example</span>
              <span>&middot;</span>
              <span>RFQ-to-BOQ Pipeline v1.0</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
