import React, { useState, useEffect, useMemo } from 'react';
import { formatDateDDMMMYYYY } from '../../utils/date';
import api from '../../api/axios';
import { useAuth } from '../../contexts/AuthContext';
import { useSearch } from '../../contexts/SearchContext';

const FeedbacksAdmin = () => {
  const { searchTerm, globalFilter } = useSearch();
  const [q, setQ] = useState('');
  const [feedbacks, setFeedbacks] = useState([]);
  const [activeTab, setActiveTab] = useState('unread'); // 'unread' or 'read'
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [notifCount, setNotifCount] = useState(0);

  const fetchList = async () => {
    try {
      setLoading(true);
      const res = await api.get('/feedbacks', { params: { q, page, limit, archived: false } });
      if (res.data && res.data.success) {
        setFeedbacks(res.data.feedbacks || []);
        setTotal(res.data.total || 0);
      }
    } catch (err) {
      console.error('Fetch feedbacks admin error', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, [q, page]);

  const { socket } = useAuth();

  useEffect(() => {
    if (!socket) return;
    socket.on('feedback:new', (payload) => {
      setNotifCount(c => c + 1);
      fetchList();
    });

    return () => {
      socket.off('feedback:new');
    };
  }, [socket]);

  const markRead = async (id) => {
    try {
      await api.put(`/feedbacks/${id}/read`);
      fetchList();
      // refresh unread count display
      try { const c = await api.get('/feedbacks/count/unread'); if (c.data?.success) setNotifCount(c.data.count||0); } catch(e){}
    } catch (err) {
      console.error('Mark read error', err);
    }
  };

  const archive = async (id) => {
    if (!window.confirm('Archive this feedback?')) return;
    try {
      await api.delete(`/feedbacks/${id}`);
      fetchList();
      try { const c = await api.get('/feedbacks/count/unread'); if (c.data?.success) setNotifCount(c.data.count||0); } catch(e){}
    } catch (err) {
      console.error('Archive error', err);
    }
  };

  // Filter feedbacks based on search and active tab (read/unread)
  const filteredFeedbacks = useMemo(() => {
    let result = feedbacks || [];

    // apply active tab
    if (activeTab === 'unread') result = result.filter(f => !(f.read ?? f.isRead));
    if (activeTab === 'read') result = result.filter(f => (f.read ?? f.isRead));

    if (searchTerm && searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(feedback => {
        const userName = feedback.user ? `${feedback.user.firstName} ${feedback.user.lastName}`.toLowerCase() : '';
        const className = feedback.class ? (feedback.class.name || '').toLowerCase() : '';
        const message = (feedback.notes || feedback.message || '').toLowerCase();
        const type = (feedback.type || '').toLowerCase();
        const date = (formatDateDDMMMYYYY(feedback.createdAt) || '').toLowerCase();

        return userName.includes(term) ||
               className.includes(term) ||
               message.includes(term) ||
               type.includes(term) ||
               date.includes(term) ||
               String(feedback._id).includes(term);
      });
    }

    return result;
  }, [feedbacks, searchTerm, activeTab]);

  // small helper: format date/time nicely
  const formatDateTime = (iso) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return iso; }
  };

  // Star rating component (0-5)
  const StarRating = ({ value = 0, max = 5 }) => {
    const v = Math.max(0, Math.min(max, Math.round(Number(value) || 0)));
    const stars = [];
    for (let i = 1; i <= max; i++) {
      stars.push(<svg key={i} className={`h-4 w-4 ${i <= v ? 'text-yellow-400' : 'text-gray-300'}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.97a1 1 0 00.95.69h4.18c.969 0 1.371 1.24.588 1.81l-3.384 2.455a1 1 0 00-.363 1.118l1.287 3.97c.3.921-.755 1.688-1.54 1.118L10 13.347l-3.384 2.455c-.784.57-1.84-.197-1.54-1.118l1.287-3.97a1 1 0 00-.363-1.118L2.615 9.397c-.783-.57-.38-1.81.588-1.81h4.18a1 1 0 00.95-.69l1.286-3.97z"/></svg>);
    }
    return <div className="flex items-center space-x-1">{stars}</div>;
  };

  return (
    <div className="p-6">
      
      <div className="bg-card rounded-lg border border-border p-4">
        {loading ? (
          <div className="text-center py-8">Loading...</div>
        ) : (
          <div className="space-y-3">
            {/* Tabs */}
            <div className="flex items-center justify-start gap-3 mb-4">
              <button onClick={() => setActiveTab('unread')} className={`px-4 py-2 rounded-md ${activeTab==='unread' ? 'bg-custom-teal text-white' : 'bg-white border'}`}>Unread</button>
              <button onClick={() => setActiveTab('read')} className={`px-4 py-2 rounded-md ${activeTab==='read' ? 'bg-custom-teal text-white' : 'bg-white border'}`}>Read</button>
              <div className="ml-auto text-sm text-muted-foreground">Showing {filteredFeedbacks.length} results</div>
            </div>

            <div className="space-y-4">
              {filteredFeedbacks.map(f => {
                const isRead = !!(f.read ?? f.isRead);
                // derive star values (convert 0-10 to 0-5 scale)
                const toStars = (n) => { if (n == null) return 0; const v = Math.round((Number(n)||0)/2); return Math.max(0, Math.min(5, v)); };
                return (
                  <div key={f._id} className={`p-4 rounded-lg border ${isRead ? 'bg-gray-50' : 'bg-white shadow-sm'}`}>
                    <div className="max-w-4xl mx-auto">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0">
                          <div className="h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center text-lg font-semibold">{(f.user?.firstName||'U').charAt(0).toUpperCase()}</div>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-start">
                            <div className="flex-1">
                              <div className="flex items-center gap-3">
                                <div className="font-semibold text-lg">{f.user?.firstName} {f.user?.lastName}</div>
                                <div className="text-sm text-muted-foreground">&middot;</div>
                                <div className="text-sm text-muted-foreground">Teacher: {f.teacher?.firstName} {f.teacher?.lastName}</div>
                                <div className="text-sm text-muted-foreground ml-3">Type: <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-800 font-medium capitalize">{f.type}</span></div>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">{formatDateTime(f.createdAt)}</div>
                            </div>
                            <div className="ml-4 flex-shrink-0 text-right">
                              <div className="text-sm text-muted-foreground">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${isRead ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                  {isRead ? 'Read' : 'Unread'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 text-sm text-foreground break-words whitespace-pre-wrap">{f.notes || f.message || <span className="text-muted-foreground">No message provided</span>}</div>

                          <div className="mt-4 grid grid-cols-2 gap-3 items-center">
                            {/* Map each numeric rating to a labeled star in two columns */}
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-muted-foreground flex-1 pr-2">First class</div>
                              <div className="flex-shrink-0"><StarRating value={toStars(f.firstClassRating)} /></div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-muted-foreground flex-1 pr-2">Teacher perf.</div>
                              <div className="flex-shrink-0"><StarRating value={toStars(f.teacherPerformanceRating)} /></div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-muted-foreground flex-1 pr-2">Attendance</div>
                              <div className="flex-shrink-0"><StarRating value={toStars(f.attendanceOnTime)} /></div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-xs text-muted-foreground flex-1 pr-2">Connection</div>
                              <div className="flex-shrink-0"><StarRating value={toStars(f.connectionQuality)} /></div>
                            </div>
                            <div className="flex items-center justify-between col-span-2">
                              <div className="text-xs text-muted-foreground flex-1 pr-2">Progress</div>
                              <div className="flex-shrink-0"><StarRating value={toStars(f.progressEvaluation)} /></div>
                            </div>
                          </div>

                          <div className="mt-4 flex items-center justify-end gap-3">
                            {!isRead && <button onClick={() => markRead(f._id)} className="px-4 py-2 bg-green-600 text-white rounded-md shadow">Mark read</button>}
                            <button onClick={() => archive(f._id)} className="px-4 py-2 bg-white border rounded-md hover:bg-gray-50">Archive</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {filteredFeedbacks.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">No feedbacks found</div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-muted-foreground">Total: {total}</div>
        <div className="space-x-2">
          <button disabled={page<=1} onClick={()=>setPage(p => Math.max(1, p-1))} className="px-3 py-1 bg-white border rounded-md">Prev</button>
          <button disabled={page*limit>=total} onClick={()=>setPage(p => p+1)} className="px-3 py-1 bg-white border rounded-md">Next</button>
        </div>
      </div>
    </div>
  );
};

export default FeedbacksAdmin;
