import React, { createContext, useContext, useState, useCallback } from 'react';

const SearchContext = createContext();

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
};

export const SearchProvider = ({ children }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('all');
  const [viewFilters, setViewFilters] = useState({});

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setGlobalFilter('all');
  }, []);

  const setFiltersForView = useCallback((view, filters) => {
    setViewFilters(prev => ({
      ...prev,
      [view]: { ...filters }
    }));
  }, []);

  const updateViewFilters = useCallback((view, updates) => {
    setViewFilters(prev => {
      const current = prev[view] || {};
      const patch = typeof updates === 'function' ? updates(current) : updates;
      return {
        ...prev,
        [view]: {
          ...current,
          ...patch
        }
      };
    });
  }, []);

  const value = {
    searchTerm,
    setSearchTerm,
    clearSearch,
    isSearchFocused,
    setIsSearchFocused,
    globalFilter,
    setGlobalFilter,
    viewFilters,
    setFiltersForView,
    updateViewFilters
  };

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  );
};