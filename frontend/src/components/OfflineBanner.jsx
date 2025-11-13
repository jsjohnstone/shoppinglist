import { WifiOff, Clock } from 'lucide-react';

export function OfflineBanner({ isOnline, queueCount }) {
  if (isOnline) return null;
  
  return (
    <div className="bg-orange-100 dark:bg-orange-900/30 border-b border-orange-200 dark:border-orange-800 px-4 py-2">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
          <WifiOff className="h-4 w-4" />
          <span className="text-sm font-medium">
            You're offline
          </span>
        </div>
        {queueCount > 0 && (
          <div className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
            <Clock className="h-4 w-4" />
            <span className="text-sm">
              {queueCount} change{queueCount !== 1 ? 's' : ''} pending
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
