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

const queryClient = new QueryClient();

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

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

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
    
    sseClient.current = new SSEClient(
      // onMessage
      (event) => {
        // Invalidate queries to refetch data
        if (event.type === 'item_added' || 
            event.type === 'item_updated' || 
            event.type === 'item_deleted' ||
            event.type === 'item_toggled') {
          queryClient.invalidateQueries(['items']);
        }
      },
      // onError
      (error) => {
        console.error('SSE error:', error);
      }
    );
    
    sseClient.current.connect(api.token);
    
    return () => {
      sseClient.current?.disconnect();
    };
  }, [user, queryClient]);

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

  // Add item mutation (back to original - queue manager causing issues)
  const addItemMutation = useMutation({
    mutationFn: (itemData) => api.addItem(itemData),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
    },
  });

  // Toggle complete mutation (back to original)
  const toggleCompleteMutation = useMutation({
    mutationFn: (id) => api.toggleItemComplete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
    },
  });

  // Delete item mutation (back to original)
  const deleteItemMutation = useMutation({
    mutationFn: (id) => api.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
    },
  });

  // Update item mutation (back to original)
  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }) => api.updateItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
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
