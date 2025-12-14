import React, { useState } from 'react';
import api from '../../api/axios';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setStatus({ type: 'success', message: res.data.message || 'If an account exists, a reset link has been sent.' });
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.message || 'Failed to send reset link.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-card p-6 rounded shadow">
        <h2 className="text-xl font-bold mb-3">Forgot Password</h2>
        <p className="text-sm text-muted-foreground mb-4">Enter your email and we'll send a link to reset your password.</p>
        {status && <div className={`p-3 rounded mb-3 ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{status.message}</div>}
        <form onSubmit={submit} className="space-y-3">
          <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 border rounded" />
          <div className="flex justify-end">
            <button disabled={loading} className="px-4 py-2 bg-primary text-white rounded">{loading ? 'Sending...' : 'Send Reset Link'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
