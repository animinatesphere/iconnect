import React from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'
import SectionHeading from '../components/SectionHeading.jsx'
import { communities, principles } from '../data/siteContent.js'

export default function CommunitiesPage() {
  return (
    <>
      <PageMeta
        title="Communities"
        description="Explore concept communities for shared interests, everyday moments, music, reading, and getting outside."
      />
      <section className="page-hero page-hero-community px-6 py-16 md:px-10 md:py-24 xl:px-14">
        <div className="mx-auto max-w-[1208px]">
          <SectionHeading
            number="01"
            eyebrow="FIND YOUR PEOPLE"
            title="Your interests,"
            emphasis="your corner."
            description="A concept for small communities around the things you love, the things you're learning, and the moments you want to share."
          >
            <Link className="button-primary page-heading-cta" to="/early-access">Follow iConnect <ArrowRight size={17} /></Link>
          </SectionHeading>
        </div>
      </section>

      <section className="community-directory section-pad">
        <div className="community-directory-heading">
          <div className="section-kicker"><span>02</span> LITTLE CORNERS, BIG INTERESTS</div>
          <p>These sample communities illustrate the direction. They're design concepts, not live groups.</p>
        </div>
        <div className="spaces-grid">
          {communities.map((community, index) => (
            <article className={`space-card ${community.className}`} key={community.name}>
              <img src={`https://images.unsplash.com/${community.image}?auto=format&fit=crop&w=720&h=560&q=85`} alt="" loading="lazy" />
              <span className="space-index">0{index + 1} / COMMUNITY CONCEPT</span>
              <div className="space-card-copy">
                <h3>{community.name}</h3>
                <p>{community.description}</p>
              </div>
              <span className="community-card-arrow"><ArrowUpRight size={18} /></span>
            </article>
          ))}
        </div>
      </section>

      <section className="community-values-section">
        <div className="community-values-inner">
          <div className="community-values-heading">
            <div className="section-kicker"><span>03</span> THE KIND OF SOCIAL WE WANT</div>
            <h2>Social should feel<br />like <span className="serif-italic">being social.</span></h2>
          </div>
          <div className="community-values-list">
            {principles.map(({ title, description, icon: Icon }, index) => (
              <article className="community-value" key={title}>
                <span className="community-value-icon"><Icon size={18} /></span>
                <span className="community-value-number">0{index + 1}</span>
                <div><h3>{title}</h3><p>{description}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
