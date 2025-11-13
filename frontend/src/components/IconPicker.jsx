import { iconList, getIcon } from '../lib/icons';
import { Button } from './ui/button';

export function IconPicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-6 gap-2">
      {iconList.map((iconName) => {
        const Icon = getIcon(iconName);
        return (
          <Button
            key={iconName}
            type="button"
            variant={value === iconName ? 'default' : 'outline'}
            size="sm"
            className="h-10 w-10 p-0"
            onClick={() => onChange(iconName)}
          >
            <Icon className="h-5 w-5" />
          </Button>
        );
      })}
    </div>
  );
}
