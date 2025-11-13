import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function DeviceEditDialog({ device, haEntities = [], onSave, onCancel }) {
  const [formData, setFormData] = useState({
    friendly_name: device.friendly_name || '',
    ha_speaker_entity: device.ha_speaker_entity || '',
    usb_device_path: device.usb_device_path || '',
  });

  const [errors, setErrors] = useState({});

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.friendly_name.trim()) {
      newErrors.friendly_name = 'Friendly name is required';
    }
    
    if (!formData.ha_speaker_entity) {
      newErrors.ha_speaker_entity = 'Speaker entity is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (validateForm()) {
      onSave(formData);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md p-6">
        <h3 className="text-lg font-bold mb-4 dark:text-white">Edit Device</h3>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="friendly_name">Friendly Name *</Label>
            <Input
              id="friendly_name"
              value={formData.friendly_name}
              onChange={(e) => setFormData({ ...formData, friendly_name: e.target.value })}
              placeholder="Kitchen Scanner"
              className={errors.friendly_name ? 'border-red-500' : ''}
            />
            {errors.friendly_name && (
              <p className="text-xs text-red-500 mt-1">{errors.friendly_name}</p>
            )}
          </div>

          <div>
            <Label htmlFor="ha_speaker_entity">Home Assistant Speaker *</Label>
            <Select 
              value={formData.ha_speaker_entity}
              onValueChange={(value) => setFormData({ ...formData, ha_speaker_entity: value })}
            >
              <SelectTrigger className={errors.ha_speaker_entity ? 'border-red-500' : ''}>
                <SelectValue placeholder="Select speaker" />
              </SelectTrigger>
              <SelectContent>
                {haEntities.length === 0 ? (
                  <SelectItem value="none" disabled>No speakers available</SelectItem>
                ) : (
                  haEntities.map((entity) => (
                    <SelectItem key={entity.entity_id} value={entity.entity_id}>
                      {entity.friendly_name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {errors.ha_speaker_entity && (
              <p className="text-xs text-red-500 mt-1">{errors.ha_speaker_entity}</p>
            )}
          </div>

          <div>
            <Label htmlFor="usb_device_path">USB Device Path</Label>
            <Input
              id="usb_device_path"
              value={formData.usb_device_path}
              onChange={(e) => setFormData({ ...formData, usb_device_path: e.target.value })}
              placeholder="/dev/ttyACM0 (optional)"
            />
            <p className="text-xs text-gray-500 mt-1">Optional - specify if multiple scanners</p>
          </div>

          <div className="flex gap-2 justify-end pt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit">
              Save Changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
