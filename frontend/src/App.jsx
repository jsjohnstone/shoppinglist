import { useState, useEffect, useRef, useCallback } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LoginForm } from '@/components/Auth/LoginForm';
import { RegisterForm } from '@/components/Auth/RegisterForm';
import { ItemList } from '@/components/ItemList';
import { ItemForm } from '@/components/ItemForm';
import { Settings } from '@/components/Settings';
import { OfflineBanner } from '@/components/OfflineBanner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import { SSEClient } from '@/lib/sseClient';
import { queueManager } from '@/lib/queueManager';
import { initDB } from '@/lib/db';
import { LogOut, ShoppingCart, Settings as SettingsIcon } from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: 1000,
    },
    mutations: {
      networkMode: 'always',
      retry: 0,
    },
  },
});

function ShoppingListApp() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authRequired, setAuthRequired] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueCount, setQueueCount] = useState(0);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [selectedListId, setSelectedListId] = useState(() => {
    return parseInt(localStorage.getItem('selectedListId') || '1');
  });
  const queryClient = useQueryClient();
  const sseClient = useRef(null);

  useEffect(() => {
    localStorage.setItem('selectedListId', String(selectedListId));
  }, [selectedListId]);

  useEffect(() => {
    initDB();
  }, []);

  const itemsQueryKey = ['items', selectedListId];

  // Online/offline detection with queue processing
  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      setProcessingQueue(true);
      try {
        const result = await queueManager.processQueue();
        if (result && result.processed > 0) {
          await queryClient.refetchQueries(itemsQueryKey, { force: true });
        } else {
          queryClient.invalidateQueries(itemsQueryKey);
        }
      } finally {
        setProcessingQueue(false);
      }
    };

    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [queryClient, selectedListId]);

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

    sseClient.current = new SSEClient(
      (event) => {
        if (processingQueue) return;

        if (event.type === 'item_moved') {
          queryClient.invalidateQueries({ queryKey: ['items'] });
        } else if (
          event.type === 'item_added' ||
          event.type === 'item_updated' ||
          event.type === 'item_deleted' ||
          event.type === 'item_toggled'
        ) {
          queryClient.invalidateQueries({ queryKey: itemsQueryKey });
        }
      },
      (error) => {
        console.error('SSE Error:', error);
      }
    );

    const token = authRequired ? api.token : null;
    sseClient.current.connect(token);

    return () => {
      sseClient.current?.disconnect();
    };
  }, [user, queryClient, processingQueue, selectedListId, authRequired]);

  // Check auth config and existing login
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const config = await api.getAuthConfig();
        setAuthRequired(config.authRequired);
        if (!config.authRequired) {
          setUser({ id: 1, username: 'default' });
          return;
        }
        if (api.token) {
          const userData = await api.getCurrentUser();
          setUser(userData);
        }
      } catch (error) {
        if (api.token) {
          try {
            const userData = await api.getCurrentUser();
            setUser(userData);
          } catch {
            setUser(null);
          }
        }
      }
    };
    checkAuth();
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

  // Fetch lists
  const { data: allLists = [] } = useQuery({
    queryKey: ['lists'],
    queryFn: () => api.getLists(),
    enabled: !!user,
  });

  // Reset selectedListId if the selected list was deleted
  useEffect(() => {
    if (allLists.length > 0 && !allLists.find(l => l.id === selectedListId)) {
      setSelectedListId(allLists[0].id);
    }
  }, [allLists, selectedListId]);

  // Fetch items for selected list
  const { data: items = [], isLoading } = useQuery({
    queryKey: itemsQueryKey,
    queryFn: () => api.getItems({ listId: selectedListId }),
    enabled: !!user,
    refetchInterval: (query) => {
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
      const dataWithList = { ...itemData, listId: itemData.listId || selectedListId };
      const tempId = `temp-${Date.now()}`;

      queryClient.setQueryData(itemsQueryKey, (old = []) => [
        { ...dataWithList, id: tempId, isOptimistic: true },
        ...old
      ]);

      try {
        const result = await api.addItem(dataWithList);
        queryClient.setQueryData(itemsQueryKey, (old = []) =>
          old.map(item => item.id === tempId ? result : item)
        );
        return result;
      } catch (error) {
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          await queueManager.queueOperation({
            type: 'add',
            data: dataWithList,
            tempId,
            listId: dataWithList.listId,
          });
          queryClient.setQueryData(itemsQueryKey, (old = []) =>
            old.map(item => item.id === tempId ? { ...item, isPending: true } : item)
          );
          return { ...dataWithList, id: tempId, isPending: true };
        }
        queryClient.setQueryData(itemsQueryKey, (old = []) =>
          old.filter(item => item.id !== tempId)
        );
        throw error;
      }
    },
    onSuccess: (result) => {
      if (!result.isPending) {
        queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      }
    },
  });

  // Toggle complete mutation with optimistic updates
  const toggleCompleteMutation = useMutation({
    mutationFn: async (id) => {
      const currentItems = queryClient.getQueryData(itemsQueryKey) || [];
      const currentItem = currentItems.find(item => item.id === id);
      const targetCompletedState = currentItem ? !currentItem.isCompleted : true;

      queryClient.setQueryData(itemsQueryKey, (old = []) =>
        old.map(item =>
          item.id === id
            ? { ...item, isCompleted: targetCompletedState, isOptimistic: true }
            : item
        )
      );

      try {
        const result = await api.toggleItemComplete(id);
        return result;
      } catch (error) {
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          await queueManager.queueOperation({
            type: 'setComplete',
            id,
            targetState: targetCompletedState
          });
          queryClient.setQueryData(itemsQueryKey, (old = []) =>
            old.map(item => item.id === id ? { ...item, isPending: true } : item)
          );
          return { id, isPending: true };
        }
        queryClient.setQueryData(itemsQueryKey, (old = []) =>
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
      if (!result?.isPending) {
        queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      }
    },
  });

  // Delete item mutation with optimistic updates
  const deleteItemMutation = useMutation({
    mutationFn: async (id) => {
      const previousItems = queryClient.getQueryData(itemsQueryKey);
      queryClient.setQueryData(itemsQueryKey, (old = []) =>
        old.filter(item => item.id !== id)
      );

      try {
        await api.deleteItem(id);
        return { id };
      } catch (error) {
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          await queueManager.queueOperation({ type: 'delete', id });
          return { id, isPending: true };
        }
        queryClient.setQueryData(itemsQueryKey, previousItems);
        throw error;
      }
    },
    onSuccess: (result) => {
      if (!result?.isPending) {
        queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      }
    },
  });

  // Update item mutation with optimistic updates
  const updateItemMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      const previousItems = queryClient.getQueryData(itemsQueryKey);
      queryClient.setQueryData(itemsQueryKey, (old = []) =>
        old.map(item =>
          item.id === id ? { ...item, ...data, isOptimistic: true } : item
        )
      );

      try {
        const result = await api.updateItem(id, data);
        return result;
      } catch (error) {
        if (error.message === 'NETWORK_TIMEOUT' || error.message === 'NETWORK_ERROR') {
          await queueManager.queueOperation({ type: 'update', id, data });
          queryClient.setQueryData(itemsQueryKey, (old = []) =>
            old.map(item => item.id === id ? { ...item, isPending: true } : item)
          );
          return { id, isPending: true };
        }
        queryClient.setQueryData(itemsQueryKey, previousItems);
        throw error;
      }
    },
    onSuccess: (result) => {
      if (!result?.isPending) {
        queryClient.invalidateQueries({ queryKey: itemsQueryKey });
      }
    },
  });

  // Move item to a different list
  const moveItemMutation = useMutation({
    mutationFn: async ({ id, listId }) => {
      queryClient.setQueryData(itemsQueryKey, (old = []) =>
        old.filter(item => item.id !== id)
      );
      return api.moveItem(id, listId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
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

  const selectedList = allLists.find(l => l.id === selectedListId);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors">
      <OfflineBanner isOnline={isOnline} queueCount={queueCount} />

      <header>
        <div className="max-w-4xl mx-auto md:px-6 px-5 md:pt-6 md:pb-5 pt-4 pb-3 flex items-center justify-between">
          {/* Left side */}
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-gray-900 dark:text-white" />
            {allLists.length > 1 ? (
              <Select value={String(selectedListId)} onValueChange={(v) => setSelectedListId(parseInt(v))}>
                <SelectTrigger className="border-none shadow-none text-xl md:text-2xl font-bold p-0 h-auto bg-transparent focus:ring-0 w-auto gap-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allLists.map(list => (
                    <SelectItem key={list.id} value={String(list.id)}>{list.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <h1 className="text-xl md:text-2xl font-bold dark:text-white">
                {selectedList?.name || 'Shopping List'}
              </h1>
            )}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 md:gap-4">
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
              <SettingsIcon className="h-4 w-4" />
              <span className="hidden md:inline ml-2">Settings</span>
            </Button>

            {authRequired && (
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="h-4 w-4" />
                <span className="hidden md:inline ml-2">Logout</span>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-0">
        <div className="mb-4 bg-white dark:bg-gray-800 rounded-lg border dark:border-gray-700 p-4 shadow-sm">
          <ItemForm
            onAdd={addItemMutation.mutateAsync}
            loading={addItemMutation.isPending}
            lists={allLists}
            selectedListId={selectedListId}
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
            onMoveItem={(id, listId) => moveItemMutation.mutate({ id, listId })}
            loading={toggleCompleteMutation.isPending || deleteItemMutation.isPending || updateItemMutation.isPending}
            categories={categories}
            lists={allLists}
            currentListId={selectedListId}
          />
        )}
      </main>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      <footer>
        <div className="max-w-4xl mx-auto px-6 pt-6 pb-8 flex items-center justify-center">
          <div className="flex items-center text-center text-gray-400">...did you get Blake a snack? 👀 🐾</div>
        </div>
      </footer>
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
