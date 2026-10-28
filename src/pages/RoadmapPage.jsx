import React from 'react'
import { ArrowDown, ArrowRight, Check, Compass } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'
import SectionHeading from '../components/SectionHeading.jsx'

const phases = [
  {
    number: '01',
    status: 'NOW',
    title: 'The website',
    description: 'Establish the iConnect brand, explain the product vision, and create a useful responsive web experience.',
    points: ['Product and brand website', 'Clear feature and roadmap communication', 'Validate interest and learn from feedback'],
    className: 'phase-current',
  },
  {
    number: '02',
    status: 'NEXT',
    title: 'The web product',
    description: 'Choose a focused first workflow, then build the account, privacy, and integration foundations it needs.',
    points: ['Prioritize core user journeys', 'Confirm partner APIs and permissions', 'Build secure account foundations'],
    className: 'phase-next',
  },
  {
    number: '03',
    status: 'LATER',
    title: 'Mobile apps',
    description: 'Plan mobile experiences after the web product has established its core use cases and priorities.',
    points: ['Apply validated product learning', 'Design for mobile-first interactions', 'Set a delivery plan when scope is known'],
    className: 'phase-later',
  },
]

export default function RoadmapPage() {
  return (
    <>
      <PageMeta
        title="Roadmap"
        description="Follow the iConnect build order: start with the website, develop the web product, and plan mobile apps later."
      />
      <section className="page-hero page-hero-roadmap px-6 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="mx-auto max-w-[1208px]">
          <SectionHeading
            number="01"
            eyebrow="ONE STEP AT A TIME"
            title="A big picture."
            emphasis="A clear first step."
            description="The long-term vision is broad. The build plan is deliberately focused: website first, mobile later."
          >
            <span className="roadmap-badge"><span className="live-dot" /> WEB FIRST</span>
          </SectionHeading>
        </div>
      </section>

      <section className="roadmap-page-section section-pad">
        <div className="phase-list">
          {phases.map((phase, index) => (
            <article className={`phase-card ${phase.className}`} key={phase.number}>
              <div className="phase-marker">
                <span>{phase.number}</span>
                {index < phases.length - 1 && <i />}
              </div>
              <div className="phase-content">
                <div className="phase-topline"><span>{phase.status}</span><span>PHASE {phase.number}</span></div>
                <h2>{phase.title}</h2>
                <p className="phase-description">{phase.description}</p>
                <ul>{phase.points.map((point) => <li key={point}><Check size={15} />{point}</li>)}</ul>
              </div>
              <div className="phase-illustration"><Compass size={32} strokeWidth={1.2} /><ArrowDown size={17} /></div>
            </article>
          ))}
        </div>
      </section>

      <section className="roadmap-note">
        <div className="roadmap-note-inner">
          <div><span className="section-kicker"><span>02</span> A LIVING PLAN</span><h2>Scope follows<br /><span className="serif-italic">what we learn.</span></h2></div>
          <div>
            <p>The product requirements describe a broad destination, not a promise that every feature is already available or has a delivery date. Integrations, privacy, safety, and technical feasibility will guide what comes next.</p>
            <Link className="arrow-link" to="/product">Explore the product vision <span><ArrowRight size={17} /></span></Link>
          </div>
        </div>
      </section>
    </>
  )
}
