export function ColorPicker({ value, onChange }) {
  const colors = [
    { name: 'Red', value: '#ef4444' },
    { name: 'Orange', value: '#f97316' },
    { name: 'Yellow', value: '#eab308' },
    { name: 'Green', value: '#10b981' },
    { name: 'Blue', value: '#3b82f6' },
    { name: 'Indigo', value: '#6366f1' },
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Brown', value: '#d97706' },
    { name: 'Gray', value: '#6b7280' },
  ];
  
  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {colors.map((color) => (
          <button
            key={color.value}
            type="button"
            className={`h-8 w-8 rounded-full border-2 ${
              value === color.value ? 'border-black' : 'border-gray-300'
            }`}
            style={{ backgroundColor: color.value }}
            onClick={() => onChange(color.value)}
            title={color.name}
          />
        ))}
      </div>
      <input
        type="color"
        value={value || '#3b82f6'}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full cursor-pointer"
      />
    </div>
  );
}
