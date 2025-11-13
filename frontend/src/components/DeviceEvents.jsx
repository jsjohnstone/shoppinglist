import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { CheckCircle, XCircle, WifiOff, Info, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

// Format timestamp as "time ago"
function timeAgo(timestamp) {
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return past.toLocaleDateString();
}

// Get icon and color for event type
function getEventIcon(eventType) {
  switch (eventType) {
    case 'scan_success':
      return { Icon: CheckCircle, color: 'text-green-600' };
    case 'scan_error':
      return { Icon: XCircle, color: 'text-red-600' };
    case 'api_error':
      return { Icon: WifiOff, color: 'text-orange-600' };
    case 'status_change':
      return { Icon: Info, color: 'text-blue-600' };
    case 'error':
      return { Icon: AlertCircle, color: 'text-red-600' };
    default:
      return { Icon: Info, color: 'text-gray-600' };
  }
}

export function DeviceEvents({ deviceId, limit = 20 }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['device-events', deviceId],
    queryFn: () => api.getDeviceEvents(deviceId, 50),
    enabled: !!deviceId,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="text-sm text-gray-500">Loading events...</div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-sm text-gray-500">No recent activity</div>
    );
  }

  const displayEvents = showAll ? events : events.slice(0, limit);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100"
      >
        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        Recent Activity ({events.length})
      </button>

      {isExpanded && (
        <div className="space-y-1 pl-6">
          {displayEvents.map((event) => {
            const { Icon, color } = getEventIcon(event.eventType);
            const metadata = event.metadata ? JSON.parse(event.metadata) : null;

            return (
              <div key={event.id} className="py-2 border-b last:border-b-0 dark:border-gray-700">
                <div className="flex items-start gap-2">
                  <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm dark:text-gray-200">{event.message}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {timeAgo(event.createdAt)}
                    </div>
                    
                    {metadata && Object.keys(metadata).length > 0 && (
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                        {metadata.barcode && (
                          <div>Barcode: {metadata.barcode}</div>
                        )}
                        {metadata.itemName && (
                          <div>Item: {metadata.itemName}</div>
                        )}
                        {metadata.categoryName && (
                          <div>Category: {metadata.categoryName}</div>
                        )}
                        {metadata.error && (
                          <div className="text-red-600 dark:text-red-400">Error: {metadata.error}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {events.length > limit && !showAll && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mt-2"
            >
              View all {events.length} events →
            </button>
          )}

          {showAll && events.length > limit && (
            <button
              onClick={() => setShowAll(false)}
              className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 mt-2"
            >
              Show less ←
            </button>
          )}
        </div>
      )}
    </div>
  );
}
