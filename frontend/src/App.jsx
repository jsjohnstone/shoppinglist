import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { LoginForm } from '@/components/Auth/LoginForm';
import { RegisterForm } from '@/components/Auth/RegisterForm';
import { ItemList } from '@/components/ItemList';
import { ItemForm } from '@/components/ItemForm';
import { Settings } from '@/components/Settings';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { LogOut, ShoppingCart, Settings as SettingsIcon } from 'lucide-react';

const queryClient = new QueryClient();

function ShoppingListApp() {
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [showSettings, setShowSettings] = useState(false);
  const queryClient = useQueryClient();

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

  // Add item mutation
  const addItemMutation = useMutation({
    mutationFn: (itemData) => api.addItem(itemData),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
    },
  });

  // Toggle complete mutation
  const toggleCompleteMutation = useMutation({
    mutationFn: (id) => api.toggleItemComplete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
    },
  });

  // Delete item mutation
  const deleteItemMutation = useMutation({
    mutationFn: (id) => api.deleteItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
    },
  });

  // Update item mutation
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
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6" />
            Shopping List
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">Hello, {user.username}!</span>
            <Button variant="ghost" size="sm" onClick={() => setShowSettings(true)}>
              <SettingsIcon className="h-4 w-4 mr-2" />
              Settings
            </Button>
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8 bg-white rounded-lg border p-4 shadow-sm">
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
