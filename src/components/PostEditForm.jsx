import React, { useId, useState } from 'react'
import { Check, X } from 'lucide-react'

export default function PostEditForm({ initialText, onCancel, onSave }) {
  const inputId = useId()
  const [text, setText] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    const updatedText = text.trim()
    if (!updatedText || saving) return
    setSaving(true)
    setError('')
    try {
      await onSave(updatedText)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The post could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="post-edit-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={inputId}>Edit post text</label>
      <textarea id={inputId} value={text} onChange={(event) => setText(event.target.value)} maxLength={500} rows={4} autoFocus />
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      <div>
        <button type="button" className="post-edit-cancel" onClick={onCancel} disabled={saving}><X size={14} /> Cancel</button>
        <button type="submit" className="app-primary-button" disabled={!text.trim() || saving}><Check size={14} /> {saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  )
}
