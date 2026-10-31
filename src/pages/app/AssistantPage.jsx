import React from 'react'
import { Bot, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'

export default function AssistantPage() {
  return (
    <div className="app-content-width assistant-page">
      <AppPageHeader eyebrow="AI ASSISTANT · NOT CONNECTED" title="AI assistant" description="This feature will be available when iConnect connects a reviewed AI service." />
      <section className="money-unavailable-card assistant-unavailable-card" role="status">
        <span className="money-unavailable-icon"><Bot size={22} /></span>
        <div>
          <span className="app-page-eyebrow">SERVICE UNAVAILABLE</span>
          <h2>No AI service is connected.</h2>
          <p>Prompts are not sent to an AI provider and this page does not generate or save replies. Please do not enter private information here.</p>
        </div>
        <LockKeyhole size={18} />
      </section>
      <section className="money-safety-note">
        <ShieldCheck size={18} />
        <div><strong>Your input stays on this page.</strong><p>There is no connected service receiving assistant prompts.</p></div>
      </section>
      <div className="money-learning-link">
        <div><span className="app-page-eyebrow">AVAILABLE TODAY</span><h3>Share with your community</h3><p>Create a text post or photo update saved to your iConnect account.</p></div>
        <Link to="/app/create">Create a post</Link>
      </div>
    </div>
  )
}
