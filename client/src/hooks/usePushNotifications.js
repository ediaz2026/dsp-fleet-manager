import { useState, useEffect } from 'react';
import api from '../api/client';

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export function usePushNotifications() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in navigator && 'Notification' in window;
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Check existing subscription on mount
  useEffect(() => {
    if (!supported) return;
    navigator.serviceWorker.ready.then(reg =>
      reg.pushManager.getSubscription().then(sub => setIsSubscribed(!!sub))
    ).catch(() => {});
  }, [supported]);

  const subscribe = async () => {
    if (!supported) return false;
    setLoading(true);
    try {
      const { data: { publicKey } } = await api.get('/push/vapid-public-key');
      if (!publicKey) { setLoading(false); return false; }

      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') { setLoading(false); return false; }

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await api.post('/push/subscribe', sub.toJSON());
      setIsSubscribed(true);
      return true;
    } catch (err) {
      console.error('[push] subscribe failed:', err);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
      }
      setIsSubscribed(false);
    } catch (err) {
      console.error('[push] unsubscribe failed:', err);
    }
  };

  return { supported, permission, isSubscribed, loading, subscribe, unsubscribe };
}
