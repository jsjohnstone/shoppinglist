import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Plus, X, Scale, StickyNote, Tag, FolderOpen, Barcode, FileText, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { getIcon } from '../lib/icons';

// Check if a string looks like a barcode (8-13 digits)
function isBarcode(input) {
  if (!input || typeof input !== 'string') return false;
  const cleaned = input.trim();
  return /^\d{8}$|^\d{12}$|^\d{13}$/.test(cleaned);
}

// Simple autocomplete component
function SimpleAutocomplete({ value, options, onSelect, onClose, onCreateNew, placeholder, icon: Icon, renderOption }) {
  const [searchValue, setSearchValue] = useState('');
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!onClose) return;

    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const filteredOptions = useMemo(() => {
    if (!searchValue) return options;
    return options.filter(option =>
      option.toLowerCase().includes(searchValue.toLowerCase())
    );
  }, [options, searchValue]);

  const showCreateOption = onCreateNew && searchValue && !filteredOptions.find(o => o.toLowerCase() === searchValue.toLowerCase());

  const handleSelect = (option) => {
    onSelect(option);
  };

  const handleCreate = () => {
    if (onCreateNew && searchValue) {
      onCreateNew(searchValue);
      onSelect(searchValue);
    }
  };

  return (
    <div ref={containerRef} className="absolute top-full left-0 mt-1 z-50 min-w-[250px]">
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-md shadow-lg">
        {/* Search input */}
        <div className="p-2 border-b dark:border-gray-600 flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-gray-500 dark:text-gray-400" />}
          <Input
            ref={inputRef}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                onClose();
              } else if (e.key === 'Enter' && filteredOptions.length === 0 && showCreateOption) {
                e.preventDefault();
                handleCreate();
              } else if (e.key === 'Enter' && filteredOptions.length === 1) {
                e.preventDefault();
                handleSelect(filteredOptions[0]);
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>

        {/* Options list */}
        {(filteredOptions.length > 0 || showCreateOption) && (
          <div className="max-h-60 overflow-auto">
            {filteredOptions.map((option) =>
              renderOption ? (
                renderOption({ option, onSelect: handleSelect })
              ) : (
                <div
                  key={option}
                  className="px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm dark:text-gray-200"
                  onClick={() => handleSelect(option)}
                >
                  {option}
                </div>
              )
            )}
            {showCreateOption && (
              <div
                className="px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm text-blue-600 dark:text-blue-400 flex items-center gap-2"
                onClick={handleCreate}
              >
                <Plus className="h-4 w-4" />
                Create "{searchValue}"
              </div>
            )}
          </div>
        )}
        
        {filteredOptions.length === 0 && !showCreateOption && searchValue && (
          <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">
            No results found
          </div>
        )}
      </div>
    </div>
  );
}

export function ItemForm({ onAdd, loading }) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [quantityDraft, setQuantityDraft] = useState('');
  const [notes, setNotes] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [relatedTo, setRelatedTo] = useState('');
  const [category, setCategory] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [processingBarcode, setProcessingBarcode] = useState(false);
  const [barcodeDetected, setBarcodeDetected] = useState(false);
  const [isMultiAdd, setIsMultiAdd] = useState(false);
  const [multiAddText, setMultiAddText] = useState('');
  
  const queryClient = useQueryClient();

  // Fetch categories
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api.getCategories(),
  });

  // Fetch items for autocomplete and related-to suggestions
  const { data: items = [] } = useQuery({
    queryKey: ['items'],
    queryFn: () => api.getItems(),
  });

  // Get category names
  const categoryNames = useMemo(() => {
    return categories.map(cat => cat.name);
  }, [categories]);

  const categoryByName = useMemo(() => {
    const map = new Map();
    categories.forEach((cat) => {
      map.set(cat.name, cat);
    });
    return map;
  }, [categories]);

  // Get active related-to values
  const activeRelatedToValues = useMemo(() => {
    const values = items
      .filter(item => !item.isCompleted && item.relatedTo)
      .map(item => item.relatedTo);
    return [...new Set(values)]; // Unique values only
  }, [items]);

  // Barcode detection and lookup
  useEffect(() => {
    const detectAndLookupBarcode = async () => {
      if (isBarcode(name) && !processingBarcode && !barcodeDetected) {
        setBarcodeDetected(true);
        setProcessingBarcode(true);
        
        try {
          // Lookup barcode from cache (we'll use existing items for now)
          // In a full implementation, this would call a barcode lookup service
          const barcode = name.trim();
          
          // For now, just mark that we detected a barcode
          // The actual barcode processing will happen on submit
          console.log('Barcode detected:', barcode);
          
          // We keep the barcode as-is in the name field
          // User can still add quantity/notes before submitting
        } catch (error) {
          console.error('Error looking up barcode:', error);
        } finally {
          setProcessingBarcode(false);
        }
      } else if (!isBarcode(name) && barcodeDetected) {
        // User edited the barcode, reset detection
        setBarcodeDetected(false);
      }
    };

    // Debounce the barcode detection
    const timeoutId = setTimeout(detectAndLookupBarcode, 300);
    return () => clearTimeout(timeoutId);
  }, [name, processingBarcode, barcodeDetected]);

  // Quick add suggestions based on previously entered items
  const itemSuggestions = useMemo(() => {
    if (!name.trim() || name.length < 2) return [];
    
    const searchTerm = name.toLowerCase();
    const suggestions = items
      .filter(item => item.name.toLowerCase().includes(searchTerm))
      .reduce((acc, item) => {
        // Deduplicate by name
        if (!acc.find(i => i.name === item.name)) {
          acc.push(item);
        }
        return acc;
      }, [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);
    
    return suggestions;
  }, [name, items]);

  // Track which fields are expanded
  const [expandedFields, setExpandedFields] = useState({
    quantity: false,
    notes: false,
    relatedTo: false,
    category: false,
  });

  const toggleField = (field) => {
    setExpandedFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const openQuantityEditor = () => {
    setQuantityDraft(quantity || '');
    setExpandedFields(prev => ({ ...prev, quantity: true }));
  };

  const closeQuantityEditor = () => {
    setExpandedFields(prev => ({ ...prev, quantity: false }));
  };

  const openNotesEditor = () => {
    setNotesDraft(notes || '');
    setExpandedFields(prev => ({ ...prev, notes: true }));
  };

  const closeNotesEditor = () => {
    setExpandedFields(prev => ({ ...prev, notes: false }));
  };

  // Create category mutation
  const createCategoryMutation = useMutation({
    mutationFn: (categoryName) => api.addCategory({ name: categoryName }),
    onSuccess: () => {
      queryClient.invalidateQueries(['categories']);
    },
  });

  const handleCreateCategory = async (newCategoryName) => {
    await createCategoryMutation.mutateAsync(newCategoryName);
  };

  const handleSelectSuggestion = (item) => {
    setName(item.name);
    setQuantity(item.quantity || '');
    setNotes(item.notes || '');
    setCategory(item.categoryName || '');
    setRelatedTo(item.relatedTo || '');
    setShowAutocomplete(false);
  };

  // Parse multi-add text into individual items
  const parseMultiAddItems = (text) => {
    const lines = text.split('\n');
    const items = [];
    
    for (const line of lines) {
      let trimmed = line.trim();
      
      // Skip empty lines
      if (!trimmed) continue;
      
      // Remove bullet points and numbers: -, *, 1., 2., etc.
      trimmed = trimmed.replace(/^[-*]\s*/, ''); // Remove - or *
      trimmed = trimmed.replace(/^\d+\.\s*/, ''); // Remove 1. 2. etc.
      trimmed = trimmed.trim();
      
      if (trimmed) {
        items.push(trimmed);
      }
    }
    
    return items;
  };

  // Count items from multi-add text
  const multiAddItemCount = useMemo(() => {
    if (!isMultiAdd) return 0;
    return parseMultiAddItems(multiAddText).length;
  }, [isMultiAdd, multiAddText]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (isMultiAdd) {
      // Multi-add mode: parse items and bulk add
      const itemTexts = parseMultiAddItems(multiAddText);
      
      if (itemTexts.length === 0) {
        return; // No items to add
      }
      
      if (itemTexts.length > 50) {
        alert('Maximum 50 items allowed per batch');
        return;
      }
      
      try {
        const categoryId = category ? categories.find(c => c.name === category)?.id : null;
        const result = await api.bulkAddItems(itemTexts, relatedTo || null, categoryId);
        
        // Invalidate items query to refetch
        queryClient.invalidateQueries(['items']);
        
        // Show success message
        console.log(`Added ${result.itemsAdded} items to shopping list`);
        
        // Clear form
        setMultiAddText('');
        setRelatedTo('');
        setCategory('');
        
        // Reset expanded fields
        setExpandedFields({
          quantity: false,
          notes: false,
          relatedTo: false,
          category: false,
        });
      } catch (error) {
        console.error('Error bulk adding items:', error);
        alert(error.message || 'Failed to add items');
      }
    } else {
      // Single add mode
      await onAdd({
        name,
        quantity: quantity || undefined,
        notes: notes || undefined,
        relatedTo: relatedTo || undefined,
        category: category || undefined,
        isBarcode: barcodeDetected,
      });

      // Clear form
      setName('');
      setQuantity('');
      setNotes('');
      setRelatedTo('');
      setCategory('');
      setBarcodeDetected(false);
      setProcessingBarcode(false);
      
      // Reset expanded fields
      setExpandedFields({
        quantity: false,
        notes: false,
        relatedTo: false,
        category: false,
      });
    }
  };

  const toggleMultiAdd = () => {
    setIsMultiAdd(!isMultiAdd);
    // Clear relevant fields when toggling
    if (!isMultiAdd) {
      // Switching to multi-add mode - clear single-add fields
      setName('');
      setQuantity('');
      setNotes('');
    } else {
      // Switching to single-add mode - clear multi-add field
      setMultiAddText('');
    }
    setBarcodeDetected(false);
    setProcessingBarcode(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <div className="flex gap-2">
          {isMultiAdd ? (
            // Multi-add mode: Show textarea
            <div className="flex-1">
              <Textarea
                value={multiAddText}
                onChange={(e) => setMultiAddText(e.target.value)}
                placeholder="Paste ingredient list (one per line)&#10;Example:&#10;2L Milk&#10;500g Flour&#10;- Eggs&#10;* Bread"
                required
                disabled={loading}
                rows={8}
                className="resize-none"
              />
              {multiAddItemCount > 0 && (
                <div className="text-xs text-gray-500 mt-1">
                  {multiAddItemCount} item{multiAddItemCount !== 1 ? 's' : ''} detected
                  {multiAddItemCount > 50 && ' (max 50 allowed)'}
                </div>
              )}
            </div>
          ) : (
            // Single-add mode: Show input
            <div className="flex-1 relative">
              <div className="relative">
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setShowAutocomplete(e.target.value.length >= 2 && !isBarcode(e.target.value));
                  }}
                  onFocus={() => setShowAutocomplete(name.length >= 2 && !isBarcode(name))}
                  onBlur={() => setTimeout(() => setShowAutocomplete(false), 200)}
                  placeholder="Add an item or scan barcode..."
                  required
                  disabled={loading}
                  className="flex-1"
                />
                {barcodeDetected && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    <Barcode className="h-4 w-4 text-gray-400" />
                    {processingBarcode && (
                      <span className="text-xs text-gray-500">Processing...</span>
                    )}
                  </div>
                )}
              </div>
              {/* Quick Add Autocomplete - only show if not a barcode */}
              {showAutocomplete && itemSuggestions.length > 0 && !barcodeDetected && (
                <div className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
                  {itemSuggestions.map((item) => (
                    <div
                      key={item.id}
                      className="px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                      onMouseDown={() => handleSelectSuggestion(item)}
                    >
                      <div className="font-medium dark:text-gray-100">{item.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 flex gap-2 mt-1">
                        {item.quantity && <span>Qty: {item.quantity}</span>}
                        {item.categoryName && <span>• {item.categoryName}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={toggleMultiAdd}
            title={isMultiAdd ? "Switch to single add" : "Switch to multi-add"}
          >
            <FileText className="h-4 w-4" />
          </Button>
          <Button 
            type="submit" 
            disabled={loading || (isMultiAdd ? multiAddItemCount === 0 || multiAddItemCount > 50 : !name)}
          >
            {isMultiAdd && multiAddItemCount > 0 ? (
              <>Add All ({multiAddItemCount})</>
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Expandable field badges */}
      <div className="flex flex-wrap gap-2">
        {/* Quantity field - only show in single-add mode */}
        {!isMultiAdd && (
          <div className="relative">
            <Badge 
              variant="interactive"
              onClick={openQuantityEditor}
              className={`gap-1 ${quantity ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200' : ''}`}
            >
              <Scale className="h-3 w-3" />
              {quantity ? quantity : 'Quantity'}
              {quantity && (
                <span
                  className="ml-1 rounded-full hover:bg-yellow-100 dark:hover:bg-yellow-900/40 p-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setQuantity('');
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </Badge>
            {expandedFields.quantity && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[250px]">
                <div className="bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-md shadow-lg p-2 flex items-center gap-2">
                  <Scale className="h-4 w-4 text-gray-500" />
                  <Input
                    value={quantityDraft}
                    onChange={(e) => setQuantityDraft(e.target.value)}
                    placeholder="Quantity (e.g., 2, 500g)"
                    disabled={loading}
                    className="flex-1 h-8 text-sm"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setQuantity(quantityDraft);
                      closeQuantityEditor();
                    }}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setQuantity('');
                      setQuantityDraft('');
                      closeQuantityEditor();
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Category field */}
        <div className="relative">
          <Badge 
            variant="interactive"
            onClick={() => toggleField('category')}
            className={`gap-1 ${category ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200' : ''}`}
          >
            <FolderOpen className="h-3 w-3" />
            {category ? category : 'Category'}
            {category && (
              <span
                className="ml-1 rounded-full hover:bg-yellow-100 dark:hover:bg-yellow-900/40 p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  setCategory('');
                }}
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </Badge>
          {expandedFields.category && (
            <SimpleAutocomplete
              value={category}
              options={categoryNames}
              onSelect={(value) => {
                setCategory(value);
                toggleField('category');
              }}
              onClose={() => toggleField('category')}
              onCreateNew={handleCreateCategory}
              placeholder="Search categories..."
              icon={FolderOpen}
              renderOption={({ option, onSelect }) => {
                const cat = categoryByName.get(option);
                const IconComp = cat?.icon ? getIcon(cat.icon) : null;
                const iconStyle = cat?.color ? { color: cat.color } : undefined;
                return (
                  <div
                    key={option}
                    className="px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm dark:text-gray-200 flex items-center gap-2"
                    onClick={() => onSelect(option)}
                  >
                    {IconComp && <IconComp className="h-3 w-3" style={iconStyle} />}
                    <span>{option}</span>
                  </div>
                );
              }}
            />
          )}
        </div>

        {/* Related To field */}
        <div className="relative">
          <Badge 
            variant="interactive"
            onClick={() => toggleField('relatedTo')}
            className={`gap-1 ${relatedTo ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200' : ''}`}
          >
            <Tag className="h-3 w-3" />
            {relatedTo ? relatedTo : 'Related To'}
            {relatedTo && (
              <span
                className="ml-1 rounded-full hover:bg-yellow-100 dark:hover:bg-yellow-900/40 p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  setRelatedTo('');
                }}
              >
                <X className="h-3 w-3" />
              </span>
            )}
          </Badge>
          {expandedFields.relatedTo && (
            <SimpleAutocomplete
              value={relatedTo}
              options={activeRelatedToValues}
              onSelect={(value) => {
                setRelatedTo(value);
                toggleField('relatedTo');
              }}
              onClose={() => toggleField('relatedTo')}
              onCreateNew={(value) => value}
              placeholder="Type or select..."
              icon={Tag}
            />
          )}
        </div>

        {/* Notes field - only show in single-add mode */}
        {!isMultiAdd && (
          <div className="relative">
            <Badge 
              variant="interactive"
              onClick={openNotesEditor}
              className={`gap-1 ${notes ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-900 dark:text-yellow-200' : ''}`}
            >
              <StickyNote className="h-3 w-3" />
              {notes ? `${notes.substring(0, 20)}${notes.length > 20 ? '...' : ''}` : 'Notes'}
              {notes && (
                <span
                  className="ml-1 rounded-full hover:bg-yellow-100 dark:hover:bg-yellow-900/40 p-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                    setNotes('');
                  }}
                >
                  <X className="h-3 w-3" />
                </span>
              )}
            </Badge>
            {expandedFields.notes && (
              <div className="absolute top-full left-0 mt-1 z-50 min-w-[250px]">
                <div className="bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-md shadow-lg p-2 flex items-center gap-2">
                  <StickyNote className="h-4 w-4 text-gray-500" />
                  <Input
                    value={notesDraft}
                    onChange={(e) => setNotesDraft(e.target.value)}
                    placeholder="Additional notes..."
                    disabled={loading}
                    className="flex-1 h-8 text-sm"
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setNotes(notesDraft);
                      closeNotesEditor();
                    }}
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setNotes('');
                      setNotesDraft('');
                      closeNotesEditor();
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </form>
  );
}
