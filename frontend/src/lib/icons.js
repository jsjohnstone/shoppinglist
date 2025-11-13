import * as Icons from 'lucide-react';

export const iconList = [
  'Carrot',
  'Apple',
  'Beef',
  'Milk',
  'Croissant',
  'Wheat',
  'Package',
  'Sparkles',
  'Spray',
  'Fish',
  'Egg',
  'Cookie',
  'Coffee',
  'Snowflake',
  'IceCream',
  'ShoppingBag',
  'ShoppingCart',
  'Circle',
  'Star',
  'Heart',
];

export function getIcon(iconName) {
  return Icons[iconName] || Icons.Circle;
}
