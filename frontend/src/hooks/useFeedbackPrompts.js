import { useState, useEffect } from 'react';
import api from '../api/axios';

export default function useFeedbackPrompts() {
  const [loading, setLoading] = useState(true);
  const [firstClassPrompts, setFirstClassPrompts] = useState([]);
  const [monthlyPrompts, setMonthlyPrompts] = useState([]);
  const [error, setError] = useState(null);

  const fetchPrompts = async () => {
    try {
      setLoading(true);
      const res = await api.get('/feedbacks/pending');
      if (res.data && res.data.success) {
        setFirstClassPrompts(res.data.firstClassPrompts || []);
        setMonthlyPrompts(res.data.monthlyPrompts || []);
      }
    } catch (err) {
      console.error('Fetch feedback prompts error', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPrompts();
    // optionally poll on return to dashboard? left to caller
  }, []);

  return { loading, firstClassPrompts, monthlyPrompts, error, refresh: fetchPrompts };
}
