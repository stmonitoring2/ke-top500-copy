'use client';
import { useState } from 'react';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string|null>(null);

  async function send() {
    setError(null);
    const res = await fetch('/auth/magic', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email }) });
    if (res.ok) setSent(true);
    else {
      const j = await res.json(); setError(j.error || 'Failed to send link');
    }
  }

  return (
    <div style={{maxWidth:420, margin:'40px auto', padding:20}}>
      <h1>Sign in</h1>
      {sent ? <p>Check your email for the magic link.</p> : (
        <>
          <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" style={{width:'100%', padding:8, margin:'12px 0'}}/>
          <button onClick={send}>Send magic link</button>
          {error && <p style={{color:'red'}}>{error}</p>}
          <p style={{marginTop:12}}><a href="/">Back to home</a></p>
        </>
      )}
    </div>
  );
}
