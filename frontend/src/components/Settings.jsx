import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Copy, Check, CheckCircle2, XCircle, Clock, Wifi, Volume2 } from 'lucide-react';
import { api } from '@/lib/api';

export function Settings({ onClose }) {
  const [activeTab, setActiveTab] = useState('api-keys');
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKey, setCopiedKey] = useState(null);
  const [haConfig, setHaConfig] = useState({ ha_url: '', ha_token: '', default_tts_service: 'tts.google_translate_say' });
  const [ollamaConfig, setOllamaConfig] = useState({ enabled: false, url: '', model: '' });
  const [selectedDevice, setSelectedDevice] = useState(null);
  const queryClient = useQueryClient();

  // API Keys queries
  const { data: apiKeys = [], isLoading: isLoadingKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => api.getApiKeys(),
  });

  // Devices queries
  const { data: devices = [], isLoading: isLoadingDevices } = useQuery({
    queryKey: ['devices'],
    queryFn: () => api.getDevices(),
  });

  // Home Assistant queries
  const { data: haConfigData, isLoading: isLoadingHA } = useQuery({
    queryKey: ['ha-config'],
    queryFn: () => api.getHAConfig(),
  });

  const { data: haEntities = [], isLoading: isLoadingEntities } = useQuery({
    queryKey: ['ha-entities'],
    queryFn: () => api.getHAEntities(),
    enabled: haConfigData?.configured === true,
  });

  // TTS Phrases queries
  const { data: ttsPhrases = [], isLoading: isLoadingPhrases } = useQuery({
    queryKey: ['tts-phrases'],
    queryFn: () => api.getTTSPhrases(),
  });

  // Ollama config queries
  const { data: ollamaConfigData, isLoading: isLoadingOllama } = useQuery({
    queryKey: ['ollama-config'],
    queryFn: () => api.getOllamaConfig(),
  });

  // Mutations
  const createKeyMutation = useMutation({
    mutationFn: (keyData) => api.createApiKey(keyData),
    onSuccess: () => {
      queryClient.invalidateQueries(['api-keys']);
      setNewKeyName('');
    },
  });

  const deleteKeyMutation = useMutation({
    mutationFn: (id) => api.deleteApiKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['api-keys']);
    },
  });

  const updateHAConfigMutation = useMutation({
    mutationFn: (config) => api.updateHAConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries(['ha-config']);
      queryClient.invalidateQueries(['ha-entities']);
    },
  });

  const testHAConnectionMutation = useMutation({
    mutationFn: () => api.testHAConnection(),
  });

  const approveDeviceMutation = useMutation({
    mutationFn: ({ id, data }) => api.approveDevice(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['devices']);
      setSelectedDevice(null);
    },
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: (id) => api.deleteDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['devices']);
    },
  });

  const updateTTSPhraseMutation = useMutation({
    mutationFn: ({ key, template }) => api.updateTTSPhrase(key, template),
    onSuccess: () => {
      queryClient.invalidateQueries(['tts-phrases']);
    },
  });

  const resetTTSPhrasesMutation = useMutation({
    mutationFn: () => api.resetTTSPhrases(),
    onSuccess: () => {
      queryClient.invalidateQueries(['tts-phrases']);
    },
  });

  const updateOllamaConfigMutation = useMutation({
    mutationFn: (config) => api.updateOllamaConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries(['ollama-config']);
    },
  });

  const testOllamaMutation = useMutation({
    mutationFn: () => api.testOllama(),
  });

  const playTTSPreview = (template) => {
    // Replace template variables with example values
    const exampleMessage = template
      .replace(/\{\{itemName\}\}/g, 'Milk');
    
    // Use Web Speech API to speak the message
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(exampleMessage);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    } else {
      alert('Text-to-speech is not supported in your browser');
    }
  };

  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    await createKeyMutation.mutateAsync({ name: newKeyName });
  };

  const copyToClipboard = async (key) => {
    await navigator.clipboard.writeText(key);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleSaveHAConfig = async (e) => {
    e.preventDefault();
    await updateHAConfigMutation.mutateAsync(haConfig);
  };

  const handleTestHAConnection = async () => {
    await testHAConnectionMutation.mutateAsync();
  };

  const getDeviceStatusBadge = (device) => {
    if (!device.is_approved) {
      return <Badge variant="outline" className="bg-yellow-100"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
    }
    const isOnline = device.last_seen && new Date() - new Date(device.last_seen) < 5 * 60 * 1000;
    return isOnline ? 
      <Badge variant="outline" className="bg-green-100"><Wifi className="h-3 w-3 mr-1" />Online</Badge> :
      <Badge variant="outline" className="bg-gray-100">Offline</Badge>;
  };

  // Initialize HA config from fetched data
  if (haConfigData && !haConfig.ha_url && haConfigData.ha_url) {
    setHaConfig({
      ha_url: haConfigData.ha_url,
      ha_token: '',
      default_tts_service: haConfigData.default_tts_service || 'tts.google_translate_say'
    });
  }

  // Initialize Ollama config from fetched data
  if (ollamaConfigData && !ollamaConfig.url && ollamaConfigData.url) {
    setOllamaConfig({
      enabled: ollamaConfigData.enabled,
      url: ollamaConfigData.url,
      model: ollamaConfigData.model
    });
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-white flex flex-col">
        <div className="p-6 border-b">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">Settings</h2>
            <Button variant="ghost" onClick={onClose}>×</Button>
          </div>
          
          {/* Tabs */}
          <div className="flex gap-2 mt-4 border-b -mb-6">
            <button
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'api-keys' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setActiveTab('api-keys')}
            >
              API Keys
            </button>
            <button
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'devices' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setActiveTab('devices')}
            >
              Devices
            </button>
            <button
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'home-assistant' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setActiveTab('home-assistant')}
            >
              Home Assistant
            </button>
            <button
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'llm' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setActiveTab('llm')}
            >
              LLM
            </button>
            <button
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === 'tts' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setActiveTab('tts')}
            >
              TTS Phrases
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {/* API Keys Tab */}
          {activeTab === 'api-keys' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                API keys allow external apps (like barcode scanners) to add items to your shopping list.
              </p>

              <form onSubmit={handleCreateKey} className="flex gap-2">
                <Input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="Key name (e.g., 'My Scanner')"
                  className="flex-1"
                />
                <Button type="submit" disabled={!newKeyName.trim() || createKeyMutation.isPending}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Key
                </Button>
              </form>

              {isLoadingKeys ? (
                <div className="text-center py-8 text-gray-500">Loading API keys...</div>
              ) : apiKeys.length === 0 ? (
                <Card className="p-8 text-center text-gray-500">
                  No API keys yet. Create one to get started.
                </Card>
              ) : (
                <div className="space-y-2">
                  {apiKeys.map((key) => (
                    <Card key={key.id} className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">{key.name}</div>
                          <div className="text-sm text-gray-600 font-mono truncate">{key.key}</div>
                          <div className="text-xs text-gray-500 mt-1">
                            Created: {new Date(key.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" onClick={() => copyToClipboard(key.key)}>
                            {copiedKey === key.key ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteKeyMutation.mutate(key.id)}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Devices Tab */}
          {activeTab === 'devices' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Manage barcode scanner devices that connect to your shopping list.
              </p>

              {isLoadingDevices ? (
                <div className="text-center py-8 text-gray-500">Loading devices...</div>
              ) : devices.length === 0 ? (
                <Card className="p-8 text-center text-gray-500">
                  No devices registered yet. Devices will appear here when they register.
                </Card>
              ) : (
                <div className="space-y-2">
                  {devices.map((device) => (
                    <Card key={device.id} className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{device.friendly_name || device.device_id}</span>
                            {getDeviceStatusBadge(device)}
                          </div>
                          <div className="text-sm text-gray-600">ID: {device.device_id}</div>
                          {device.ha_speaker_entity && (
                            <div className="text-sm text-gray-600">Speaker: {device.ha_speaker_entity}</div>
                          )}
                          {device.last_seen && (
                            <div className="text-xs text-gray-500 mt-1">
                              Last seen: {new Date(device.last_seen).toLocaleString()}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {!device.is_approved && (
                            <Button size="sm" onClick={() => setSelectedDevice(device)}>
                              Approve
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" onClick={() => deleteDeviceMutation.mutate(device.id)}>
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Device Approval Modal */}
              {selectedDevice && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                  <Card className="w-full max-w-md p-6 bg-white">
                    <h3 className="text-lg font-bold mb-4">Approve Device</h3>
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.target);
                      approveDeviceMutation.mutate({
                        id: selectedDevice.id,
                        data: {
                          friendly_name: formData.get('friendly_name'),
                          ha_speaker_entity: formData.get('ha_speaker_entity'),
                          usb_device_path: formData.get('usb_device_path') || null,
                        }
                      });
                    }}>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="friendly_name">Friendly Name</Label>
                          <Input
                            id="friendly_name"
                            name="friendly_name"
                            defaultValue={selectedDevice.device_id}
                            required
                          />
                        </div>
                        <div>
                          <Label htmlFor="ha_speaker_entity">Home Assistant Speaker</Label>
                          <Select name="ha_speaker_entity" required>
                            <SelectTrigger>
                              <SelectValue placeholder="Select speaker" />
                            </SelectTrigger>
                            <SelectContent>
                              {haEntities.map((entity) => (
                                <SelectItem key={entity.entity_id} value={entity.entity_id}>
                                  {entity.friendly_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label htmlFor="usb_device_path">USB Device Path (optional)</Label>
                          <Input
                            id="usb_device_path"
                            name="usb_device_path"
                            placeholder="/dev/ttyACM0"
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button type="button" variant="outline" onClick={() => setSelectedDevice(null)}>
                            Cancel
                          </Button>
                          <Button type="submit">Approve</Button>
                        </div>
                      </div>
                    </form>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* Home Assistant Tab */}
          {activeTab === 'home-assistant' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Configure Home Assistant integration for TTS announcements.
              </p>

              <form onSubmit={handleSaveHAConfig} className="space-y-4">
                <div>
                  <Label htmlFor="ha_url">Home Assistant URL</Label>
                  <Input
                    id="ha_url"
                    value={haConfig.ha_url}
                    onChange={(e) => setHaConfig({ ...haConfig, ha_url: e.target.value })}
                    placeholder="http://homeassistant.local:8123"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="ha_token">Long-Lived Access Token</Label>
                  <Input
                    id="ha_token"
                    type="password"
                    value={haConfig.ha_token}
                    onChange={(e) => setHaConfig({ ...haConfig, ha_token: e.target.value })}
                    placeholder="Enter your HA token"
                    required={!haConfigData?.has_token}
                  />
                  {haConfigData?.has_token && (
                    <p className="text-xs text-gray-500 mt-1">Leave blank to keep existing token</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="default_tts_service">Default TTS Service</Label>
                  <Input
                    id="default_tts_service"
                    value={haConfig.default_tts_service}
                    onChange={(e) => setHaConfig({ ...haConfig, default_tts_service: e.target.value })}
                    placeholder="tts.google_translate_say"
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={updateHAConfigMutation.isPending}>
                    Save Configuration
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestHAConnection}
                    disabled={testHAConnectionMutation.isPending || !haConfigData?.configured}
                  >
                    Test Connection
                  </Button>
                </div>
              </form>

              {testHAConnectionMutation.data && (
                <Card className={`p-4 ${testHAConnectionMutation.data.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2">
                    {testHAConnectionMutation.data.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    <span className="font-medium">
                      {testHAConnectionMutation.data.success ? 'Connection successful!' : 'Connection failed'}
                    </span>
                  </div>
                  <p className="text-sm mt-1">{testHAConnectionMutation.data.message || testHAConnectionMutation.data.error}</p>
                </Card>
              )}
            </div>
          )}

          {/* LLM Configuration Tab */}
          {activeTab === 'llm' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Configure external Ollama for AI-powered item categorization and normalization.
              </p>

              <form onSubmit={async (e) => {
                e.preventDefault();
                await updateOllamaConfigMutation.mutateAsync(ollamaConfig);
              }} className="space-y-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="ollama_enabled"
                    checked={ollamaConfig.enabled}
                    onChange={(e) => setOllamaConfig({ ...ollamaConfig, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor="ollama_enabled" className="cursor-pointer">
                    Enable LLM Processing
                  </Label>
                </div>
                {!ollamaConfig.enabled && (
                  <p className="text-xs text-gray-500 bg-yellow-50 border border-yellow-200 rounded p-2">
                    When disabled, items will be added exactly as entered without AI categorization.
                  </p>
                )}

                <div>
                  <Label htmlFor="ollama_url">Ollama URL</Label>
                  <Input
                    id="ollama_url"
                    value={ollamaConfig.url}
                    onChange={(e) => setOllamaConfig({ ...ollamaConfig, url: e.target.value })}
                    placeholder="http://192.168.5.109:11434"
                    disabled={!ollamaConfig.enabled}
                    required={ollamaConfig.enabled}
                  />
                  <p className="text-xs text-gray-500 mt-1">URL of your external Ollama instance</p>
                </div>

                <div>
                  <Label htmlFor="ollama_model">Model Name</Label>
                  <Input
                    id="ollama_model"
                    value={ollamaConfig.model}
                    onChange={(e) => setOllamaConfig({ ...ollamaConfig, model: e.target.value })}
                    placeholder="llama3.2"
                    disabled={!ollamaConfig.enabled}
                    required={ollamaConfig.enabled}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Recommended: llama3.2, phi3:mini, or qwen2.5:0.5b
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={updateOllamaConfigMutation.isPending}>
                    Save Configuration
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => testOllamaMutation.mutate()}
                    disabled={testOllamaMutation.isPending || !ollamaConfig.enabled}
                  >
                    {testOllamaMutation.isPending ? 'Testing...' : 'Test Connection'}
                  </Button>
                </div>
              </form>

              {testOllamaMutation.data && (
                <Card className={`p-4 ${testOllamaMutation.data.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  <div className="flex items-center gap-2">
                    {testOllamaMutation.data.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-600" />
                    )}
                    <span className="font-medium">
                      {testOllamaMutation.data.success ? 'Connection successful!' : 'Connection failed'}
                    </span>
                  </div>
                  {testOllamaMutation.data.message && (
                    <p className="text-sm mt-1">{testOllamaMutation.data.message}</p>
                  )}
                  {testOllamaMutation.data.test_response && (
                    <p className="text-xs text-gray-600 mt-1">Test response: {testOllamaMutation.data.test_response}</p>
                  )}
                  {testOllamaMutation.data.error && (
                    <p className="text-sm mt-1">{testOllamaMutation.data.error}</p>
                  )}
                  {testOllamaMutation.data.details && (
                    <p className="text-xs text-gray-500 mt-1">{testOllamaMutation.data.details}</p>
                  )}
                </Card>
              )}

              {updateOllamaConfigMutation.isSuccess && (
                <Card className="p-4 bg-green-50 border-green-200">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="font-medium">Configuration saved successfully!</span>
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* TTS Phrases Tab */}
          {activeTab === 'tts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Customize the TTS messages announced when items are scanned.
                </p>
                <Button variant="outline" size="sm" onClick={() => resetTTSPhrasesMutation.mutate()}>
                  Reset to Defaults
                </Button>
              </div>

              {isLoadingPhrases ? (
                <div className="text-center py-8 text-gray-500">Loading TTS phrases...</div>
              ) : (
                <div className="space-y-4">
                  {ttsPhrases.map((phrase) => (
                    <Card key={phrase.id} className="p-4">
                      <Label htmlFor={`phrase-${phrase.phrase_key}`} className="font-medium capitalize">
                        {phrase.phrase_key.replace('_', ' ')}
                      </Label>
                      <p className="text-xs text-gray-500 mb-2">
                        Available variables: {'{{itemName}}'}
                      </p>
                      <div className="flex gap-2">
                        <Input
                          id={`phrase-${phrase.phrase_key}`}
                          defaultValue={phrase.template}
                          onBlur={(e) => {
                            if (e.target.value !== phrase.template) {
                              updateTTSPhraseMutation.mutate({
                                key: phrase.phrase_key,
                                template: e.target.value
                              });
                            }
                          }}
                          className="flex-1"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => playTTSPreview(phrase.template)}
                          title="Test phrase in browser"
                        >
                          <Volume2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
