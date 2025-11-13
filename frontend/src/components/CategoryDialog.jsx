import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { IconPicker } from './IconPicker';
import { ColorPicker } from './ColorPicker';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Label } from './ui/label';

export function CategoryDialog({ category, open, onClose, onSave }) {
  const [formData, setFormData] = useState({
    name: category?.name || '',
    icon: category?.icon || 'Circle',
    color: category?.color || '#3b82f6'
  });
  
  const handleSave = () => {
    onSave(formData);
    onClose();
  };
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>
            {category ? 'Edit Category' : 'Add Category'}
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          <div>
            <Label>Name</Label>
            <Input
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Category name"
              className="mt-1"
            />
          </div>
          
          <div>
            <Label>Icon</Label>
            <div className="mt-1">
              <IconPicker
                value={formData.icon}
                onChange={(icon) => setFormData({ ...formData, icon })}
              />
            </div>
          </div>
          
          <div>
            <Label>Color</Label>
            <div className="mt-1">
              <ColorPicker
                value={formData.color}
                onChange={(color) => setFormData({ ...formData, color })}
              />
            </div>
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.name.trim()}>Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
