import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import type { NotificationsListResponse, UserNotification } from '@pos/shared';
import { Bell, Check, CheckCheck, AlertTriangle, AlertCircle, Info, RefreshCw } from 'lucide-react';
import { Badge } from '@pos/ui';

interface NotificationBellProps {
  onNavigate: (link: string) => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ onNavigate }) => {
  const [data, setData] = useState<NotificationsListResponse | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await apiFetch<NotificationsListResponse>('/api/notifications');
      setData(res);
    } catch (err) {
      console.error('Failed to fetch notifications', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000); // 1-minute refresh
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleMarkAsRead = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setData((prev) => {
        if (!prev) return prev;
        const updated = prev.items.map((item) =>
          item.id === id ? { ...item, isRead: true, readAt: new Date().toISOString() } : item
        );
        const unreadCount = updated.filter((i) => !i.isRead).length;
        return { ...prev, items: updated, unreadCount };
      });
    } catch (err) {
      console.error('Error marking read', err);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await apiFetch('/api/notifications/mark-all-read', { method: 'POST' });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((i) => ({ ...i, isRead: true })),
          unreadCount: 0,
        };
      });
    } catch (err) {
      console.error('Error marking all read', err);
    }
  };

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<NotificationsListResponse>('/api/notifications/refresh', {
        method: 'POST',
      });
      setData(res);
    } catch (err) {
      console.error('Error refreshing notifications', err);
    } finally {
      setLoading(false);
    }
  };

  const unreadCount = data?.unreadCount || 0;

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />;
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors focus:outline-none"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-red-600 text-[9px] font-bold text-white shadow-xs animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications Dropdown Popover */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 md:w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          {/* Header */}
          <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">Notifications</span>
              {unreadCount > 0 && (
                <Badge variant="destructive" className="text-[10px] py-0 px-1.5 font-bold">
                  {unreadCount} new
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleRefresh}
                disabled={loading}
                title="Refresh alerts"
                className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 px-2 py-0.5 rounded hover:bg-blue-50"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {/* Items List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {data?.items && data.items.length > 0 ? (
              data.items.map((notif: UserNotification) => (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (notif.link) {
                      onNavigate(notif.link);
                      setIsOpen(false);
                    }
                  }}
                  className={`p-3 transition-colors flex items-start gap-3 cursor-pointer ${
                    notif.isRead
                      ? 'bg-white hover:bg-slate-50/80'
                      : 'bg-blue-50/40 hover:bg-blue-50/70'
                  }`}
                >
                  <div className="mt-0.5">{getSeverityIcon(notif.severity)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={`text-xs truncate ${notif.isRead ? 'font-medium text-slate-800' : 'font-bold text-slate-900'}`}
                      >
                        {notif.title}
                      </p>
                      <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">
                        {notif.createdAt ? notif.createdAt.slice(11, 16) : ''}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-relaxed">
                      {notif.message}
                    </p>
                  </div>
                  {!notif.isRead && (
                    <button
                      onClick={(e) => handleMarkAsRead(notif.id, e)}
                      title="Mark as read"
                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-colors mt-0.5"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                No active notifications. You are all caught up!
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
