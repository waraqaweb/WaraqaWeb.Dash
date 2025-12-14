import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../api/axios';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(null);
  const [id, setId] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = searchParams.get('token');
    const i = searchParams.get('id');
    setToken(t);
    setId(i);
  }, [searchParams]);

  const submit = async (e) => {
    e.preventDefault();
    if (!token || !id) return setStatus({ type: 'error', message: 'Invalid reset link' });
    if (password.length < 6) return setStatus({ type: 'error', message: 'Password must be at least 6 characters' });
    if (password !== confirm) return setStatus({ type: 'error', message: 'Passwords do not match' });

    setLoading(true);
    try {
      const res = await api.post('/auth/reset-password', { id, token, newPassword: password });
      setStatus({ type: 'success', message: res.data.message || 'Password reset successfully' });
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setStatus({ type: 'error', message: err.response?.data?.message || 'Failed to reset password' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-card p-6 rounded shadow">
        <h2 className="text-xl font-bold mb-3">Reset Password</h2>
        {status && <div className={`p-3 rounded mb-3 ${status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{status.message}</div>}
        <form onSubmit={submit} className="space-y-3">
          <input type="password" required placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 border rounded" />
          <input type="password" required placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full px-3 py-2 border rounded" />
          <div className="flex justify-end">
            <button disabled={loading} className="px-4 py-2 bg-primary text-white rounded">{loading ? 'Resetting...' : 'Reset Password'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
