import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

// Two-tier search state:
//   • inputValue / setInputValue — fast, updated on every keystroke. ONLY
//     the GlobalSearchBar subscribes via useSearchInput(). Other pages do
//     not re-render on each key.
//   • searchTerm — debounced commit of inputValue (~300ms). Heavy pages
//     consume it via useSearch() to trigger filtering / fetching. This is
//     what eliminates the dropped-keystroke problem on pages like
//     ClassesPage where dozens of memos depend on the search term.

const SearchInputContext = createContext(null);
const SearchContext = createContext(null);

const SEARCH_DEBOUNCE_MS = 300;

export const useSearch = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
};

// Used only by GlobalSearchBar.
export const useSearchInput = () => {
  const context = useContext(SearchInputContext);
  if (!context) {
    throw new Error('useSearchInput must be used within a SearchProvider');
  }
  return context;
};

export const SearchProvider = ({ children }) => {
  const [inputValue, setInputValueState] = useState('');
  const [searchTerm, setSearchTermState] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [globalFilter, setGlobalFilter] = useState('all');
  const [viewFilters, setViewFilters] = useState({});

  // Debounced promotion: inputValue → searchTerm.
  useEffect(() => {
    if (inputValue === searchTerm) return undefined;
    const timer = setTimeout(() => {
      setSearchTermState(inputValue);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue, searchTerm]);

  const setInputValue = useCallback((next) => {
    setInputValueState(next);
  }, []);

  // External callers (URL sync, programmatic set) — keep both aligned so
  // the input mirrors the change immediately.
  const setSearchTerm = useCallback((next) => {
    setInputValueState((prev) => (typeof next === 'function' ? next(prev) : next));
    setSearchTermState((prev) => (typeof next === 'function' ? next(prev) : next));
  }, []);

  const clearSearch = useCallback(() => {
    setInputValueState('');
    setSearchTermState('');
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

  const inputContextValue = {
    inputValue,
    setInputValue,
    clearSearch,
  };

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
    updateViewFilters,
  };

  return (
    <SearchInputContext.Provider value={inputContextValue}>
      <SearchContext.Provider value={value}>
        {children}
      </SearchContext.Provider>
    </SearchInputContext.Provider>
  );
};