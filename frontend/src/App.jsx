import { useState, useEffect, useRef } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LoginForm } from '@/components/Auth/LoginForm';
import { RegisterForm } from '@/components/Auth/RegisterForm';
import { ItemList } from '@/components/ItemList';
import { ItemForm } from '@/components/ItemForm';
import { Settings } from '@/components/Settings';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { SSEClient } from '@/lib/sseClient';
import { queueManager } from '@/lib/queueManager';
import { initDB } from '@/lib/db';
import { LogOut, ShoppingCart, Settings as SettingsIcon, Moon, Sun } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep retrying failed queries
      retry: 3,
      retryDelay: 1000,
    },
    mutations: {
      // CRITICAL: Don't pause mutations when offline - let our error handling deal with it
      networkMode: 'always',
      // Don't retry, let our queue handle it
      retry: 0,
    },
  },
});

function ShoppingListApp() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [showSettings, setShowSettings] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    // Check localStorage or system preference
    const saved = localStorage.getItem('darkMode');
    if (saved !== null) return saved === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [processingQueue, setProcessingQueue] = useState(false);
  const queryClient = useQueryClient();
  const sseClient = useRef(null);

  // Apply dark mode class to document
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('darkMode', darkMode.toString());
  }, [darkMode]);

  // Initialize IndexedDB
  useEffect(() => {
    initDB();
  }, []);

  // Online/offline detection with queue processing
  useEffect(() => {
    const handleOnline = async () => {
      console.log('🌐 Back online! Processing queued operations...');
      setIsOnline(true);
      setProcessingQueue(true);
      
      try {
        // Process queue when coming back online
        const result = await queueManager.processQueue();
        
        if (result && result.processed > 0) {
          console.log(`🔄 Refreshing UI after processing ${result.processed} operations`);
          // Force immediate refetch of items to get real server state
          await queryClient.refetchQueries(['items'], { force: true });
          console.log('✅ UI refreshed with server state');
        } else {
          // Still refresh even if no queue items, in case SSE missed updates
          console.log('🔄 Refreshing UI to sync with server');
          queryClient.invalidateQueries(['items']);
        }
      } finally {
        // Always re-enable SSE handling after queue completes
        setProcessingQueue(false);
      }
    };
    
    const handleOffline = () => {
      console.log('📴 Gone offline');
      setIsOnline(false);
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [queryClient]);

  // Update queue count
  useEffect(() => {
    const interval = setInterval(async () => {
      const count = await queueManager.getQueueCount();
      setQueueCount(count);
    }, 2000);
    
    return () => clearInterval(interval);
  }, []);

  // SSE connection for real-time updates
  useEffect(() => {
    if (!user) return;
    
    console.log('🔌 Initializing SSE connection for user:', user.username);
    
    sseClient.current = new SSEClient(
      // onMessage
      (event) => {
        console.log('📥 SSE event received:', event.type);
        
        // CRITICAL: Ignore SSE events while processing queue to prevent race conditions
        if (processingQueue) {
          console.log('⏸️  Ignoring SSE event (queue processing in progress)');
          return;
        }
        
        // Invalidate queries to refetch data
        if (event.type === 'item_added' || 
            event.type === 'item_updated' || 
            event.type === 'item_deleted' ||
            event.type === 'item_toggled') {
          console.log('🔄 Invalidating items query due to:', event.type);
          queryClient.invalidateQueries(['items']);
        }
      },
      // onError
      (error) => {
        console.error('❌ SSE Error in App:', error);
      }
    );
    
    const connected = sseClient.current.connect(api.token);
    if (!connected) {
      console.warn('⚠️ SSE not supported, relying on manual refresh');
    }
    
    return () => {
      console.log('🔌 Disconnecting SSE');
      sseClient.current?.disconnect();
    };
  }, [user, queryClient, processingQueue]);

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const userData = await api.getCurrentUser();
        setUser(userData);
      } catch (error) {
        // Not logged in
        setUser(null);
      }
    };
    
    if (api.token) {
      checkAuth();
    }
  }, []);

  const handleLogin = async (username, password) => {
    const data = await api.login(username, password);
    setUser(data.user);
  };

  const handleRegister = async (username, password) => {
    const data = await api.register(username, password);
    setUser(data.user);
  };

  const handleLogout = () => {
    api.logout();
    setUser(null);
    queryClient.clear();
  };

  // Fetch items
  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ['items'],
    queryFn: () => api.getItems(),
    enabled: !!user,
    refetchInterval: (query) => {
      // Poll every 2 seconds if there are processing items
      const data = query?.state?.data;
      const hasProcessing = Array.isArray(data) && data.some(item => item.isProcessing);
      return hasProcessing ? 2000 : false;
    },
  });

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
    enabled: !!user,
  });

  // Add item mutation with optimistic updates and offline support
  const addItemMutation = useMutation({
    mutationFn: async (itemData) => {
      console.log('➕ Add item mutation called:', itemData);
      const tempId = `temp-${Date.now()}`;
      
      // Add optimistically to UI
      console.log('✨ Adding optimistic item with tempId:', tempId);
      queryClient.setQueryData(['items'], (old = []) => [
        { ...itemData, id: tempId, isOptimistic: true },
        ...old
      ]);
      
      try {
        console.log('📡 Attempting API call...');
        const result = await api.addItem(itemData);
        console.log('✅ API call succeeded:', result);
        // Replace optimistic with real
        queryClient.setQueryData(['items'], (old = []) =>
          old.map(item => item.id === tempId ? result : item)
        );
        return result;
      } catch (error) {
        console.log('❗ API call failed:', error.message);
        // Check if it's a network error
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          console.log('📦 Network error detected - queueing operation');
          try {
            await queueManager.queueOperation({
              type: 'add',
              data: itemData,
              tempId
            });
            console.log('✅ Operation queued successfully');
            // Keep optimistic item with pending indicator
            queryClient.setQueryData(['items'], (old = []) =>
              old.map(item => item.id === tempId ? { ...item, isPending: true } : item)
            );
            return { ...itemData, id: tempId, isPending: true };
          } catch (queueError) {
            console.error('❌ Failed to queue operation:', queueError);
            throw queueError;
          }
        }
        console.log('❌ Real error (not network) - removing optimistic item');
        // Real error - remove optimistic item
        queryClient.setQueryData(['items'], (old = []) =>
          old.filter(item => item.id !== tempId)
        );
        throw error;
      }
    },
    onSuccess: (result) => {
      console.log('🎉 Mutation onSuccess:', result);
      if (!result.isPending) {
        queryClient.invalidateQueries(['items']);
      }
    },
    onError: (error) => {
      console.error('💥 Mutation onError:', error);
    },
  });

  // Toggle complete mutation with optimistic updates
  const toggleCompleteMutation = useMutation({
    mutationFn: async (id) => {
      console.log('🔄 Toggle mutation called for item:', id);
      
      // Get current item to know what state we're toggling TO
      const currentItems = queryClient.getQueryData(['items']) || [];
      const currentItem = currentItems.find(item => item.id === id);
      const targetCompletedState = currentItem ? !currentItem.isCompleted : true;
      
      // Optimistic toggle
      console.log('✨ Toggling item optimistically to:', targetCompletedState);
      queryClient.setQueryData(['items'], (old = []) =>
        old.map(item =>
          item.id === id
            ? { ...item, isCompleted: targetCompletedState, isOptimistic: true }
            : item
        )
      );
      
      try {
        console.log('📡 Attempting toggle API call...');
        const result = await api.toggleItemComplete(id);
        console.log('✅ Toggle API call succeeded:', result);
        return result;
      } catch (error) {
        console.log('❗ Toggle API call failed:', error.message);
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          console.log('📦 Network error - queueing setComplete operation with target state:', targetCompletedState);
          try {
            // IMPORTANT: Store the TARGET state, not just "toggle"
            await queueManager.queueOperation({
              type: 'setComplete',
              id,
              targetState: targetCompletedState
            });
            console.log('✅ SetComplete operation queued');
            // Keep optimistic state with pending indicator
            queryClient.setQueryData(['items'], (old = []) =>
              old.map(item => item.id === id ? { ...item, isPending: true } : item)
            );
            return { id, isPending: true };
          } catch (queueError) {
            console.error('❌ Failed to queue toggle:', queueError);
            throw queueError;
          }
        }
        console.log('↩️ Real error - rolling back toggle');
        // Rollback on real error
        queryClient.setQueryData(['items'], (old = []) =>
          old.map(item =>
            item.id === id
              ? { ...item, isCompleted: !targetCompletedState, isOptimistic: false }
              : item
          )
        );
        throw error;
      }
    },
    onSuccess: (result) => {
      console.log('🎉 Toggle mutation onSuccess:', result);
      if (!result?.isPending) {
        queryClient.invalidateQueries(['items']);
      }
    },
    onError: (error) => {
      console.error('💥 Toggle mutation onError:', error);
    },
  });

  // Delete item mutation with optimistic updates
  const deleteItemMutation = useMutation({
    mutationFn: async (id) => {
      // Optimistic delete
      const previousItems = queryClient.getQueryData(['items']);
      queryClient.setQueryData(['items'], (old = []) =>
        old.filter(item => item.id !== id)
      );
      
      try {
        await api.deleteItem(id);
        return { id };
      } catch (error) {
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          console.log('📦 Queueing delete operation for later');
          await queueManager.queueOperation({
            type: 'delete',
            id
          });
          return { id, isPending: true };
        }
        // Rollback on real error
        queryClient.setQueryData(['items'], previousItems);
        throw error;
      }
    },
    onSuccess: (result) => {
      if (!result?.isPending) {
        queryClient.invalidateQueries(['items']);
      }
    },
  });

  // Update item mutation with optimistic updates
  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      // Optimistic update
      const previousItems = queryClient.getQueryData(['items']);
      queryClient.setQueryData(['items'], (old = []) =>
        old.map(item =>
          item.id === id ? { ...item, ...data, isOptimistic: true } : item
        )
      );
      
      try {
        const result = await api.updateItem(id, data);
        return result;
      } catch (error) {
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          console.log('📦 Queueing update operation for later');
          await queueManager.queueOperation({
            type: 'update',
            id,
            data
          });
          queryClient.setQueryData(['items'], (old = []) =>
            old.map(item => item.id === id ? { ...item, isPending: true } : item)
          );
          return { id, isPending: true };
        }
        // Rollback on real error
        queryClient.setQueryData(['items'], previousItems);
        throw error;
      }
    },
    onSuccess: (result) => {
      if (!result?.isPending) {
        queryClient.invalidateQueries(['items']);
      }
    },
  });

  if (!user) {
    return authMode === 'login' ? (
      <LoginForm
        onLogin={handleLogin}
        onToggleMode={() => setAuthMode('register')}
      />
    ) : (
      <RegisterForm
        onRegister={handleRegister}
        onToggleMode={() => setAuthMode('login')}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      <OfflineBanner isOnline={isOnline} queueCount={queueCount} />
      
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-3 md:py-4 flex items-center justify-between">
          {/* Left side */}
          <div className="flex items-center gap-2">
            {/* Logo icon - always visible */}
            <ShoppingCart className="h-6 w-6 text-gray-900 dark:text-white" />
            
            {/* Title - visible on all screen sizes */}
            <h1 className="text-xl md:text-2xl font-bold dark:text-white">Shopping List</h1>
          </div>
          
          {/* Right side */}
          <div className="flex items-center gap-2 md:gap-4">
            {/* Welcome message - hidden on mobile */}
            <span className="hidden md:inline text-sm text-gray-600 dark:text-gray-300">
              Hello, {user.username}!
            </span>
            
            {/* Dark mode toggle */}
            <Button variant="ghost" size="sm" onClick={() => setDarkMode(!darkMode)}>
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            
            {/* Settings button */}
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
              <SettingsIcon className="h-4 w-4" />
              <span className="hidden md:inline ml-2">Settings</span>
            </Button>
            
            {/* Logout button */}
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4" />
              <span className="hidden md:inline ml-2">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-4">
        <div className="mb-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 shadow-sm">
          <ItemForm
            onAdd={addItemMutation.mutateAsync}
            loading={addItemMutation.isPending}
          />
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading items...</div>
        ) : (
          <ItemList
            items={items}
            onToggleComplete={toggleCompleteMutation.mutate}
            onDelete={deleteItemMutation.mutate}
            onUpdate={(id, data) => updateItemMutation.mutate({ id, data })}
            loading={toggleCompleteMutation.isPending || deleteItemMutation.isPending || updateItemMutation.isPending}
            categories={categories}
          />
        )}
      </main>

      {/* Settings Modal */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ShoppingListApp />
    </QueryClientProvider>
  );
}

export default App;
