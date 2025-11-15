import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Trash2, Loader2, GripVertical, Search, List, FolderOpen, Scale, StickyNote, Tag, ChevronRight, ChevronDown, ChevronUp, Barcode, Edit2, Save, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CategoryBadge } from './CategoryBadge';
import { getIcon } from '../lib/icons';

// Simple autocomplete for edit mode
function SimpleAutocomplete({ value, options, onSelect, onClose, onCreateNew, placeholder, icon: Icon }) {
  const [searchValue, setSearchValue] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filteredOptions = useMemo(() => {
    if (!searchValue) return options;
    return options.filter(option =>
      option.toLowerCase().includes(searchValue.toLowerCase())
    );
  }, [options, searchValue]);

  const showCreateOption = onCreateNew && searchValue && !filteredOptions.find(o => o.toLowerCase() === searchValue.toLowerCase());

  return (
    <div className="absolute top-full left-0 mt-1 z-50 min-w-[200px]">
      <div className="bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-md shadow-lg max-h-48 overflow-auto">
        <div className="p-2 border-b dark:border-gray-600 flex items-center gap-2">
          {Icon && <Icon className="h-3 w-3 text-gray-500 dark:text-gray-400" />}
          <Input
            ref={inputRef}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={placeholder}
            className="flex-1 h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'Enter' && filteredOptions.length === 1) {
                e.preventDefault();
                onSelect(filteredOptions[0]);
              }
            }}
          />
        </div>
        {filteredOptions.map((option) => (
          <div
            key={option}
            className="px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-xs dark:text-gray-200"
            onClick={() => onSelect(option)}
          >
            {option}
          </div>
        ))}
        {showCreateOption && (
          <div
            className="px-3 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-xs text-blue-600 dark:text-blue-400"
            onClick={() => {
              onCreateNew(searchValue);
              onSelect(searchValue);
            }}
          >
            Create "{searchValue}"
          </div>
        )}
      </div>
    </div>
  );
}

function SortableItem({ item, onToggleComplete, onDelete, onUpdate, loading, categories, items, isCategoryView = false, isFaded = false }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: item.name,
    quantity: item.quantity || '',
    notes: item.notes || '',
    relatedTo: item.relatedTo || '',
    category: item.categoryName || '',
  });
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [showRelatedToPicker, setShowRelatedToPicker] = useState(false);

  const queryClient = useQueryClient();

  // Get category names - must be called unconditionally
  const categoryNames = useMemo(() => {
    return categories.map(cat => cat.name);
  }, [categories]);

  // Get active related-to values - must be called unconditionally
  const activeRelatedToValues = useMemo(() => {
    const values = items
      .filter(i => !i.isCompleted && i.relatedTo)
      .map(i => i.relatedTo);
    return [...new Set(values)];
  }, [items]);

  // Create category mutation - must be called unconditionally
  const createCategoryMutation = useMutation({
    mutationFn: (categoryName) => api.addCategory({ name: categoryName }),
    onSuccess: () => {
      queryClient.invalidateQueries(['categories']);
    },
  });

  // Sortable hooks - must be called unconditionally
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const showCategoryBadge = !isCategoryView && !item.isCompleted && item.categoryName;
  const showRelatedTag = !isCategoryView && !item.isCompleted && item.relatedTo;
  const showScannedTag = !item.isCompleted && item.wasScanned;

  const showTagRow = item.isProcessing || showCategoryBadge || showRelatedTag || showScannedTag;
  const showNotesRow = !!item.notes || (isCategoryView && !item.isCompleted && item.relatedTo);
  const hasBelowContent = showTagRow || showNotesRow;

  const handleSave = async () => {
    await onUpdate(item.id, {
      name: editData.name,
      quantity: editData.quantity || undefined,
      notes: editData.notes || undefined,
      relatedTo: editData.relatedTo || undefined,
      category: editData.category || undefined,
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditData({
      name: item.name,
      quantity: item.quantity || '',
      notes: item.notes || '',
      relatedTo: item.relatedTo || '',
      category: item.categoryName || '',
    });
    setIsEditing(false);
  };

  // Handlers
  if (isEditing) {
    return (
      <div 
        ref={setNodeRef}
        style={style}
        className="flex items-start gap-3 p-3 border-b dark:border-gray-700 last:border-b-0 bg-blue-50 dark:bg-blue-900/20"
      >
        <div className="flex-1 space-y-2">
          {/* Name */}
          <Input
            value={editData.name}
            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
            placeholder="Item name"
            className="h-8 text-sm"
          />
          
          {/* Quantity, Category, Related To in a row */}
          <div className="flex gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[120px]">
              <Scale className="h-3 w-3 text-gray-500" />
              <Input
                value={editData.quantity}
                onChange={(e) => setEditData({ ...editData, quantity: e.target.value })}
                placeholder="Quantity"
                className="h-7 text-xs flex-1"
              />
            </div>
            
            <div className="relative flex-1 min-w-[120px]">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-3 w-3 text-gray-500" />
                <Input
                  value={editData.category}
                  onChange={(e) => setEditData({ ...editData, category: e.target.value })}
                  onFocus={() => setShowCategoryPicker(true)}
                  placeholder="Category"
                  className="h-7 text-xs flex-1"
                />
              </div>
              {showCategoryPicker && (
                <SimpleAutocomplete
                  value={editData.category}
                  options={categoryNames}
                  onSelect={(value) => {
                    setEditData({ ...editData, category: value });
                    setShowCategoryPicker(false);
                  }}
                  onClose={() => setShowCategoryPicker(false)}
                  onCreateNew={async (name) => {
                    await createCategoryMutation.mutateAsync(name);
                  }}
                  placeholder="Search categories..."
                  icon={FolderOpen}
                />
              )}
            </div>

            <div className="relative flex-1 min-w-[120px]">
              <div className="flex items-center gap-2">
                <Tag className="h-3 w-3 text-gray-500" />
                <Input
                  value={editData.relatedTo}
                  onChange={(e) => setEditData({ ...editData, relatedTo: e.target.value })}
                  onFocus={() => setShowRelatedToPicker(true)}
                  placeholder="Related to"
                  className="h-7 text-xs flex-1"
                />
              </div>
              {showRelatedToPicker && (
                <SimpleAutocomplete
                  value={editData.relatedTo}
                  options={activeRelatedToValues}
                  onSelect={(value) => {
                    setEditData({ ...editData, relatedTo: value });
                    setShowRelatedToPicker(false);
                  }}
                  onClose={() => setShowRelatedToPicker(false)}
                  placeholder="Type or select..."
                  icon={Tag}
                />
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="flex items-center gap-2">
            <StickyNote className="h-3 w-3 text-gray-500" />
            <Input
              value={editData.notes}
              onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
              placeholder="Notes"
              className="h-7 text-xs flex-1"
            />
          </div>
        </div>

        {/* Save/Cancel buttons */}
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSave}
            className="h-8 w-8"
            disabled={!editData.name}
          >
            <Save className="h-4 w-4 text-green-600" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            className="h-8 w-8"
          >
            <X className="h-4 w-4 text-gray-600" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-3 p-3 border-b last:border-b-0 transition-all duration-300 ease-in-out ${item.isCompleted ? 'opacity-60' : ''} ${item.isProcessing ? 'opacity-50' : ''} ${isFaded ? 'opacity-40' : ''} ${isDragging ? 'cursor-grabbing touch-none' : 'cursor-pointer'}`}
    >
      <Checkbox
        checked={item.isCompleted}
        onCheckedChange={() => onToggleComplete(item.id)}
        className={`mt-0.5 ${hasBelowContent ? 'self-start' : ''}`}
        disabled={item.isProcessing}
      />
      <div className="flex-1 min-w-0 relative">
        <div
          className={`font-medium flex items-center gap-2 ${
            item.isCompleted
              ? 'text-gray-400 dark:text-gray-500 line-through'
              : 'text-gray-900 dark:text-gray-100'
          }`}
        >
          {item.isProcessing && (
            <Loader2 className="h-4 w-4 animate-spin text-blue-500 dark:text-blue-400" />
          )}
          {item.name}
          {item.quantity && (
            <span
              className={`ml-2 text-sm flex items-center gap-1 ${
                item.isCompleted
                  ? 'text-gray-400 dark:text-gray-500'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              <Scale className="h-3 w-3" />
              {item.quantity}
            </span>
          )}
        </div>
        {showNotesRow && (
          <div
            className={`mt-1 flex items-center gap-2 text-sm ${
              item.isCompleted
                ? 'text-gray-400 dark:text-gray-500'
                : 'text-gray-600 dark:text-gray-400'
            }`}
          >
            {isCategoryView && !item.isCompleted && item.relatedTo && (
              <span className="text-xs px-2 py-0.5 rounded bg-transparent border border-gray-400 text-gray-700 dark:text-gray-300 dark:border-gray-500 flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {item.relatedTo}
              </span>
            )}
            {item.notes && <span className="truncate">{item.notes}</span>}
          </div>
        )}
        {showTagRow && (
          <div className="flex gap-2 mt-1">
            {item.isProcessing && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded flex items-center gap-1">
                Processing...
              </span>
            )}
            {showCategoryBadge && (
              <CategoryBadge 
                name={item.categoryName}
                icon={item.categoryIcon}
                color={item.categoryColor}
              />
            )}
            {showRelatedTag && (
              <span className="text-xs px-2 py-0.5 rounded bg-transparent border border-gray-400 text-gray-700 dark:text-gray-300 dark:border-gray-500 flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {item.relatedTo}
              </span>
            )}
            {showScannedTag && (
              <span className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded flex items-center gap-1">
                <Barcode className="h-3 w-3" />
              </span>
            )}
          </div>
        )}
        {isFaded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-b from-transparent to-white" />
        )}
      </div>
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            setIsEditing(true);
          }}
          disabled={loading || item.isProcessing}
        >
          <Edit2 className="h-4 w-4 text-blue-600" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item.id);
          }}
          disabled={loading || item.isProcessing}
        >
          <Trash2 className="h-4 w-4 text-red-600" />
        </Button>
      </div>
    </div>
  );
}

export function ItemList({ items, onToggleComplete, onDelete, onUpdate, loading, categories = [] }) {
  const [viewMode, setViewMode] = useState('list');
  const [sortBy, setSortBy] = useState('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [localItems, setLocalItems] = useState(items);
  const [collapsedCategories, setCollapsedCategories] = useState(new Set());
  const [expandedCompletedCategories, setExpandedCompletedCategories] = useState(new Set());
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 500,
        tolerance: 15,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const sortItemsWithCompletion = useCallback((a, b) => {
    // Processing items first
    if (a.isProcessing !== b.isProcessing) {
      return a.isProcessing ? -1 : 1;
    }

    // Incomplete items next
    if (a.isCompleted !== b.isCompleted) {
      return a.isCompleted ? 1 : -1;
    }

    // Then apply selected sort option
    switch (sortBy) {
      case 'newest':
        return new Date(b.createdAt) - new Date(a.createdAt);
      case 'oldest':
        return new Date(a.createdAt) - new Date(b.createdAt);
      case 'a-z':
        return a.name.localeCompare(b.name);
      case 'manual':
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      default:
        return 0;
    }
  }, [sortBy]);

  const categorySortOrderMap = useMemo(() => {
    const map = new Map();
    categories.forEach((cat) => {
      map.set(cat.name, cat.sortOrder ?? Number.MAX_SAFE_INTEGER);
    });
    return map;
  }, [categories]);

  // Update local items when props change
  useMemo(() => {
    setLocalItems(items);
  }, [items]);

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: (itemOrders) => api.reorderItems(itemOrders),
    onSuccess: () => {
      queryClient.invalidateQueries(['items']);
    },
  });

  // Filter items by search query
  const searchedItems = useMemo(() => {
    if (!searchQuery.trim()) return localItems;
    
    const query = searchQuery.toLowerCase();
    return localItems.filter(item => 
      item.name.toLowerCase().includes(query) ||
      item.categoryName?.toLowerCase().includes(query) ||
      item.notes?.toLowerCase().includes(query) ||
      item.relatedTo?.toLowerCase().includes(query)
    );
  }, [localItems, searchQuery]);

  // Sort items
  const sortedItems = useMemo(() => {
    const sorted = [...searchedItems];
    return sorted.sort(sortItemsWithCompletion);
  }, [searchedItems, sortItemsWithCompletion]);

  // Group items by category for category view
  const groupedByCategory = useMemo(() => {
    if (viewMode !== 'category') return null;
    
    const groups = {};
    sortedItems.forEach(item => {
      // Processing uncategorised items are handled separately at the top of category view
      if (item.isProcessing && !item.categoryName) return;

      const category = item.categoryName || 'Uncategorized';
      if (!groups[category]) {
        groups[category] = {
          items: [],
          icon: item.categoryIcon,
          color: item.categoryColor,
          completedCount: 0,
          totalCount: 0,
        };
      }
      groups[category].items.push(item);
      groups[category].totalCount++;
      if (item.isCompleted) {
        groups[category].completedCount++;
      }
    });
    
    // Sort items within each category (processing first, then incomplete, then by selected sort)
    Object.keys(groups).forEach(category => {
      groups[category].items = groups[category].items.sort(sortItemsWithCompletion);
    });
    
    return groups;
  }, [sortedItems, viewMode, sortItemsWithCompletion]);

  // Separate active and completed items for list view is no longer needed;
  // we render a single combined list ordered by completion + sort option.

  const handleDragEnd = (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      setLocalItems((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        
        const newItems = arrayMove(items, oldIndex, newIndex);
        
        // Update sort orders and send to backend
        const itemOrders = newItems.map((item, index) => ({
          id: item.id,
          sortOrder: index,
        }));
        
        reorderMutation.mutate(itemOrders);
        
        return newItems;
      });
    }
  };

  const toggleCategory = (category) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(category)) {
        newSet.delete(category);
      } else {
        newSet.add(category);
      }
      return newSet;
    });
  };

  const expandCompletedCategory = (category) => {
    setExpandedCompletedCategories(prev => {
      const newSet = new Set(prev);
      newSet.add(category);
      return newSet;
    });
  };

  const collapseCompletedCategory = (category) => {
    setExpandedCompletedCategories(prev => {
      const newSet = new Set(prev);
      newSet.delete(category);
      return newSet;
    });
  };

  if (items.length === 0) {
    return (
      <Card className="p-8 text-center text-gray-500">
        No items in your shopping list. Add some items to get started!
      </Card>
    );
  }

  const processingUncategorised = useMemo(() => {
    if (viewMode !== 'category') return [];
    return sortedItems.filter(item => item.isProcessing && !item.categoryName);
  }, [viewMode, sortedItems]);

  const renderItemList = (itemsToRender, title, categoryName = null, categoryIcon = null, categoryColor = null, completedCount = null, totalCount = null) => {
    const isCollapsed = categoryName && collapsedCategories.has(categoryName);
    const Icon = categoryIcon ? getIcon(categoryIcon) : null;
    const showCounts = completedCount !== null && totalCount !== null;
    const isCategoryView = !!categoryName;

    let itemsForDisplay = itemsToRender;
    let fadedCompletedId = null;
    let hiddenCompletedCount = 0;
    let completedItems = [];

    if (isCategoryView) {
      const activeItems = itemsToRender.filter(item => !item.isCompleted);
      completedItems = itemsToRender.filter(item => item.isCompleted);
      const isExpanded = expandedCompletedCategories.has(categoryName);

      let visibleCompleted = completedItems;
      if (completedItems.length > 2 && !isExpanded) {
        visibleCompleted = completedItems.slice(0, 3);
        fadedCompletedId = visibleCompleted[2].id;
        hiddenCompletedCount = completedItems.length - 3;
      }

      itemsForDisplay = [...activeItems, ...visibleCompleted];
    }
    
    return (
      <Card key={title}>
        {categoryName && (
          <div 
            className="p-4 border-b dark:border-gray-700 flex items-center justify-between cursor-pointer"
            style={categoryColor ? {
              backgroundColor: `${categoryColor}20`,
              borderBottomColor: categoryColor,
            } : {}}
            onClick={() => categoryName && toggleCategory(categoryName)}
          >
            <h2 className="font-semibold flex items-center gap-2" style={categoryColor ? { color: categoryColor } : {}}>
              {categoryName && (
                isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
              )}
              {Icon && <Icon className="h-5 w-5" />}
              {title}
              {showCounts && (
                <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">
                  {completedCount}/{totalCount}
                </span>
              )}
            </h2>
          </div>
        )}
        {!isCollapsed && (

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={itemsForDisplay.map(item => item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div>
                {itemsForDisplay.map(item => (
                  <SortableItem
                    key={item.id}
                    item={item}
                    onToggleComplete={onToggleComplete}
                    onDelete={onDelete}
                    onUpdate={onUpdate}
                    loading={loading}
                    categories={categories}
                    items={items}
                    isCategoryView={isCategoryView}
                    isFaded={item.id === fadedCompletedId}
                  />
                ))}
                {isCategoryView && completedItems.length > 3 && (
                  <div className="flex justify-center py-2">
                    {hiddenCompletedCount > 0 ? (
                      <button
                        type="button"
                        className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-700"
                        onClick={() => expandCompletedCategory(categoryName)}
                      >
                        <ChevronDown className="h-3 w-3" />
                        <span>Show {hiddenCompletedCount} more completed</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-gray-500 flex items-center gap-1 hover:text-gray-700"
                        onClick={() => collapseCompletedCategory(categoryName)}
                      >
                        <ChevronUp className="h-3 w-3" />
                        <span>Hide completed items</span>
                      </button>
                    )}
                  </div>
                )}

              </div>
            </SortableContext>
          </DndContext>
        )}
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex gap-3 flex-wrap items-center">
        {/* Search bar */}
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search items..."
            className="pl-10"
          />
        </div>

        {/* View toggle */}
        <ToggleGroup>
          <ToggleGroupItem
            active={viewMode === 'list'}
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4 mr-2" />
            List
          </ToggleGroupItem>
          <ToggleGroupItem
            active={viewMode === 'category'}
            onClick={() => setViewMode('category')}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            Category
          </ToggleGroupItem>
        </ToggleGroup>

        {/* Sort dropdown */}
        <div className="min-w-[150px]">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger>
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a-z">A to Z</SelectItem>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Render based on view mode */}
      {viewMode === 'list' ? (
        sortedItems.length > 0 && (
          <Card>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedItems.map(item => item.id)}
                strategy={verticalListSortingStrategy}
              >
                <div>
                  {sortedItems.map(item => (
                    <SortableItem
                      key={item.id}
                      item={item}
                      onToggleComplete={onToggleComplete}
                      onDelete={onDelete}
                      onUpdate={onUpdate}
                      loading={loading}
                      categories={categories}
                      items={items}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          </Card>
        )
      ) : (
        <>
          {/* Uncategorised processing items at the very top, outside any category */}
          {processingUncategorised.length > 0 &&
            renderItemList(processingUncategorised, 'Processing')}

          {Object.entries(groupedByCategory || {})
            .sort(([aName, aData], [bName, bData]) => {
              // Calculate incomplete count for each category
              const aIncomplete = aData.totalCount - aData.completedCount;
              const bIncomplete = bData.totalCount - bData.completedCount;

              // If both have incomplete items, or both are fully complete, sort by category sortOrder (then name)
              if ((aIncomplete > 0 && bIncomplete > 0) || (aIncomplete === 0 && bIncomplete === 0)) {
                const aSortOrder = categorySortOrderMap.get(aName) ?? Number.MAX_SAFE_INTEGER;
                const bSortOrder = categorySortOrderMap.get(bName) ?? Number.MAX_SAFE_INTEGER;

                if (aSortOrder !== bSortOrder) {
                  return aSortOrder - bSortOrder;
                }

                return aName.localeCompare(bName);
              }
              
              // Categories with incomplete items come first
              return bIncomplete - aIncomplete;
            })
            .map(([category, categoryData]) =>
              renderItemList(
                categoryData.items, 
                category, 
                category, 
                categoryData.icon, 
                categoryData.color,
                categoryData.completedCount,
                categoryData.totalCount
              )
            )}
        </>
      )}

      {searchedItems.length === 0 && searchQuery && (
        <Card className="p-8 text-center text-gray-500">
          No items found matching "{searchQuery}"
        </Card>
      )}
    </div>
  );
}
