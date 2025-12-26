import React, { useState, useEffect, useRef } from "react";
import { Loader2, Search, X } from "lucide-react";

const EMPTY_OPTIONS_FETCH = () => Promise.resolve([]);
const EMPTY_BY_ID_FETCH = () => Promise.resolve(null);

const useDebouncedValue = (value, delay = 250) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

const ensureArray = (value) => {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.data) ? value.data : [];
};

const normalizeText = (value = "") =>
  value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const optionMatchesQuery = (option, normalizedQuery) => {
  if (!normalizedQuery) return true;
  const haystacks = [
    option.label,
    option.subtitle,
    option.raw?.firstName,
    option.raw?.lastName,
    option.raw?.email,
    option.raw?.studentName,
    option.raw?.guardianName,
  ]
    .filter(Boolean)
    .map((value) => normalizeText(value))
    .filter(Boolean);
  if (!haystacks.length) return false;
  return haystacks.some((text) => text.includes(normalizedQuery));
};

const filterOptionsByQuery = (options, query) => {
  if (!query) return options;
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return options;
  return options.filter((option) => optionMatchesQuery(option, normalizedQuery));
};

const SearchSelect = ({
  label,
  value = "",
  onChange,
  fetchOptions,
  fetchById,
  placeholder = "Search...",
  helperText,
  required = false,
  disabled = false,
  noResultsText = "No matches found",
}) => {
  const [inputValue, setInputValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [options, setOptions] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [, setSelectedOption] = useState(null);
  const containerRef = useRef(null);
  const prevValueRef = useRef(value);
  const fallbackSearchRef = useRef("");
  const debouncedSearch = useDebouncedValue(searchTerm, 200);

  useEffect(() => {
    fallbackSearchRef.current = "";
  }, [debouncedSearch]);

  useEffect(() => {
    if (!isOpen || disabled) return;
    let ignore = false;

    const load = async () => {
      const currentFetchOptions = fetchOptions || EMPTY_OPTIONS_FETCH;
      setIsLoading(true);
      setError("");
      try {
        const list = await currentFetchOptions(debouncedSearch || "");
        if (ignore) return;
        let normalized = ensureArray(list);
        let filtered = filterOptionsByQuery(normalized, debouncedSearch);

        if (
          debouncedSearch &&
          filtered.length === 0 &&
          fallbackSearchRef.current !== debouncedSearch
        ) {
          fallbackSearchRef.current = debouncedSearch;
          try {
            const fallbackList = await currentFetchOptions("");
            if (ignore) return;
            normalized = ensureArray(fallbackList);
            filtered = filterOptionsByQuery(normalized, debouncedSearch);
          } catch (fallbackErr) {
            if (!ignore) {
              console.warn(
                "SearchSelect fallback fetch failed",
                fallbackErr?.message || fallbackErr
              );
            }
          }
        }

        setOptions(filtered);
        setActiveIndex(filtered.length ? 0 : -1);
      } catch (err) {
        if (ignore) return;
        console.warn("SearchSelect options fetch failed", err?.message || err);
        setError("Unable to load results. Try again.");
        setOptions([]);
        setActiveIndex(-1);
      } finally {
        if (!ignore) setIsLoading(false);
      }
    };

    load();
    return () => {
      ignore = true;
    };
  }, [debouncedSearch, disabled, isOpen, fetchOptions]);

  useEffect(() => {
    let ignore = false;

    const syncSelected = async () => {
      const currentFetchById = fetchById || EMPTY_BY_ID_FETCH;
      if (!value) {
        if (prevValueRef.current) {
          setSelectedOption(null);
          setInputValue("");
        }
        prevValueRef.current = value;
        return;
      }

      const match = options.find((opt) => String(opt.id) === String(value));
      if (match) {
        setSelectedOption(match);
        setInputValue(match.label || "");
        prevValueRef.current = value;
        return;
      }

      try {
        const fetched = await currentFetchById(value);
        if (!ignore && fetched) {
          setSelectedOption(fetched);
          setInputValue(fetched.label || "");
        }
      } catch (err) {
        if (!ignore) {
          console.warn("SearchSelect fetchById failed", err?.message || err);
        }
      } finally {
        prevValueRef.current = value;
      }
    };

    syncSelected();
    return () => {
      ignore = true;
    };
  }, [options, fetchById, value]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (disabled) {
      setIsOpen(false);
    }
  }, [disabled]);

  const handleOptionSelect = (option) => {
    if (disabled) return;
    setSelectedOption(option || null);
    setInputValue(option?.label || "");
    setIsOpen(false);
    setSearchTerm("");
    setActiveIndex(-1);
    onChange?.(option || null);
  };

  const handleInputChange = (event) => {
    if (disabled) return;
    const next = event.target.value;
    setInputValue(next);
    setSearchTerm(next);
    if (!isOpen) setIsOpen(true);
  };

  const handleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (!options.length) return;
      setActiveIndex((prev) => {
        if (prev === -1) return 0;
        if (event.key === "ArrowDown") {
          return (prev + 1) % options.length;
        }
        return prev - 1 < 0 ? options.length - 1 : prev - 1;
      });
    } else if (event.key === "Enter") {
      if (isOpen && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        handleOptionSelect(options[activeIndex]);
      }
    } else if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  };

  const handleClear = () => {
    if (disabled) return;
    setSelectedOption(null);
    setInputValue("");
    setSearchTerm("");
    setOptions([]);
    setActiveIndex(-1);
    onChange?.(null);
  };

  return (
    <div className="flex flex-col" ref={containerRef}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              setSearchTerm((prev) => prev);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#2C736C] disabled:bg-gray-100 disabled:cursor-not-allowed"
        />
        {inputValue && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            aria-label="Clear selection"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {helperText && (
        <p className="mt-1 text-xs text-gray-500">{helperText}</p>
      )}

      {isOpen && !disabled && (
        <div className="relative z-30">
          <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading...
              </div>
            ) : error ? (
              <div className="px-3 py-2 text-sm text-red-600">{error}</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500">{noResultsText}</div>
            ) : (
              options.map((option, index) => (
                <button
                  key={option.id || option.value || index}
                  type="button"
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    index === activeIndex ? 'bg-[#2C736C]/10 text-[#2C736C]' : 'hover:bg-gray-50'
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => handleOptionSelect(option)}
                >
                  <div className="font-medium text-gray-900">{option.label || option.name}</div>
                  {option.subtitle && (
                    <div className="text-xs text-gray-500">{option.subtitle}</div>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {required && (
        <input
          className="sr-only"
          tabIndex={-1}
          value={value || ''}
          onChange={() => {}}
          required
          readOnly
        />
      )}
    </div>
  );
};

export default SearchSelect;
