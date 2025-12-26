import React, { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import FloatingTimezone from '../../components/ui/FloatingTimezone';
import api from '../../api/axios';
import ConfirmModal from '../../components/ui/ConfirmModal';
import Toast from '../../components/ui/Toast';

const Settings = () => {
  const { user, socket } = useAuth();

  // Compact/condensed layout toggle (defaults to condensed for dense Google-like UI)
  const [condensed, setCondensed] = useState(true);
  const [firstClassWindowHours, setFirstClassWindowHours] = useState(24);
  const [savingWindow, setSavingWindow] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    // fetch admin setting
    const fetchSetting = async () => {
      try {
        const res = await api.get('/settings/firstClassWindowHours');
        if (res.data && res.data.setting) {
          setFirstClassWindowHours(Number(res.data.setting.value) || 24);
        }
      } catch (err) {
        // Setting doesn't exist yet - use default value
        if (err.response?.status === 404) {
          setFirstClassWindowHours(24); // Default value
        }
      }
    };
    fetchSetting();
  }, []);

  // Branding (logo/title/slogan) - admin only
  const [branding, setBranding] = useState({ logo: null, title: 'Waraqa', slogan: '' });
  const [logoFile, setLogoFile] = useState(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    (async () => {
      try {
        const res = await api.get('/settings/branding');
        if (res.data?.branding) setBranding(res.data.branding);
      } catch (e) {
        // ignore
      }
    })();
  }, [user?.role]);

  return (
    <div className={`p-6 bg-background min-h-screen`}> 
      <div className="max-w-7xl mx-auto">
        <FloatingTimezone />
        <div className={`mb-4 ${condensed ? 'text-sm' : 'text-base'}`}>
          <div className="flex items-center justify-between mb-3">
            <h1 className={`font-semibold ${condensed ? 'text-lg' : 'text-2xl'}`}>Settings</h1>
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setCondensed(s => !s)}
                className="text-xs px-2 py-1 border rounded bg-white"
                title="Toggle compact view"
              >
                {condensed ? 'Compact' : 'Comfort'}
              </button>
            </div>
          </div>
        </div>

      <div className="space-y-4">
        {/* Timezone converter moved to floating widget to keep page body cleaner. */}
        {/* Floating widget component will be rendered separately (fixed position). */}
        
        {/* Feedback card */}
        {user?.role === 'admin' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4 flex items-start justify-between">
            <div>
              <div className="font-medium mb-2">Feedback Settings</div>
              <div className="flex items-center space-x-3">
                <input type="number" min={1} value={firstClassWindowHours} onChange={(e)=>setFirstClassWindowHours(Number(e.target.value))} className="px-3 py-2 border rounded w-32" />
                <div className="text-sm text-muted">Controls how long after class end the first-class modal can appear.</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={()=>setConfirmOpen(true)} className={`text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded ${savingWindow ? 'opacity-70' : ''}`}>Save</button>
            </div>
          </div>
        )}

        {/* Branding card */}
        {user?.role === 'admin' && (
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden p-4">
            <div className="flex items-start justify-between">
              <div className="font-medium">Branding</div>
              <div className="flex items-center gap-2">
                <button onClick={async ()=>{ try { await api.put('/settings/branding.title', {value: branding.title}); await api.put('/settings/branding.slogan', {value: branding.slogan}); setToast({type:'success', message:'Branding saved'}); if (socket && socket.emit) socket.emit('branding:updated', {branding:{...branding}}); } catch(err){ console.error(err); setToast({type:'error', message:'Save failed'}); } }} className="text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded">Save</button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <div className="md:col-span-1 flex items-center justify-center">
                <div className="h-28 w-28 bg-card rounded border border-border overflow-hidden flex items-center justify-center">
                  {branding.logo?.url ? (
                    <img src={branding.logo.url} alt="logo" className="h-full w-full object-contain" />
                  ) : branding.logo?.dataUri ? (
                    <img src={branding.logo.dataUri} alt="logo" className="h-full w-full object-contain" />
                  ) : (
                    <div className="text-xs text-muted-foreground">No logo</div>
                  )}
                </div>
              </div>

              <div className="md:col-span-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e)=>{
                    const f = e.target.files && e.target.files[0];
                    if (f) {
                      const allowed = ['image/png','image/jpeg','image/webp'];
                      const maxBytes = 5*1024*1024;
                      if (!allowed.includes(f.type)) { setToast({type:'error', message:'Unsupported file type.'}); setLogoFile(null); return; }
                      if (f.size > maxBytes) { setToast({type:'error', message:'File too large (max 5MB).'}); setLogoFile(null); return; }
                    }
                    setLogoFile(f);
                  }} className="text-sm" />

                  <button onClick={async ()=>{
                    if (!logoFile) { setToast({type:'error', message:'Select file first.'}); return; }
                    setUploadingLogo(true);
                    try {
                      const fd = new FormData(); fd.append('file', logoFile);
                      const res = await api.post('/settings/branding/logo', fd, { headers: {'Content-Type':'multipart/form-data'} });
                      if (res.data?.success) { setBranding(b=>({...b, logo: res.data.setting.value})); setToast({type:'success', message: res.data.fallback? 'Saved (fallback)' : 'Uploaded'}); if (socket && socket.emit) socket.emit('branding:updated', {branding:{...branding, logo: res.data.setting.value}}); }
                    } catch(err){ console.error('Logo upload failed', err); setToast({type:'error', message: err.response?.data?.message || err.message || 'Upload failed'}); } finally { setUploadingLogo(false); }
                  }} className="text-xs px-2 py-1 bg-gray-100 text-gray-800 border border-gray-200 rounded">{uploadingLogo? 'Uploading' : 'Upload'}</button>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="text" value={branding.title||''} onChange={(e)=>setBranding(b=>({...b, title: e.target.value}))} className="px-3 py-2 border rounded w-full truncate" placeholder="Site title" />
                  <input type="text" value={branding.slogan||''} onChange={(e)=>setBranding(b=>({...b, slogan: e.target.value}))} className="px-3 py-2 border rounded w-full truncate" placeholder="Slogan" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <ConfirmModal
        open={confirmOpen}
        title="Save Feedback Settings"
        message={`Are you sure you want to set the first-class feedback window to ${firstClassWindowHours} hours?`}
        onCancel={()=>setConfirmOpen(false)}
        onConfirm={async ()=>{
          setConfirmOpen(false);
          try {
            setSavingWindow(true);
            const res = await api.put('/settings/firstClassWindowHours', { value: firstClassWindowHours });
            if (res.data && res.data.success) {
              // show small toast (simple)
              // TODO: replace with styled toast component
            }
          } catch (err) {
            console.error('Save setting error', err);
          } finally { setSavingWindow(false); }
        }}
        confirmText="Save"
        cancelText="Cancel"
      />
      {toast && (
        <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
      )}
      </div>
    </div>
  );
};

export default Settings;
