import { getIcon } from '../lib/icons';

export function CategoryBadge({ name, icon, color }) {
  const Icon = getIcon(icon);
  
  return (
    <span 
      className="text-xs px-2 py-0.5 rounded flex items-center gap-1 w-fit"
      style={{
        backgroundColor: color ? `${color}15` : '#e5e7eb',
        color: color || '#374151',
        border: `1px solid ${color || '#9ca3af'}`
      }}
    >
      {icon && <Icon className="h-3 w-3" />}
      {name}
    </span>
  );
}
