import React, { useState, useEffect, useRef } from 'react';
import { Search, Clock, Globe, X, Check } from 'lucide-react';
import { getTimezoneInfo, DEFAULT_TIMEZONE, getBrowserTimezone, getTimezoneDisplayLabel, getDynamicTimezoneList } from '../../utils/timezoneUtils';

const TimezoneSelector = ({ 
  value = DEFAULT_TIMEZONE, 
  onChange, 
  placeholder = "Search for timezone...",
  className = "",
  required = false,
  disabled = false,
  showDetectButton = true,
  showCurrentTime = false,
  error = null
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredTimezones, setFilteredTimezones] = useState([]);
  const [selectedTimezone, setSelectedTimezone] = useState(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [currentTime, setCurrentTime] = useState('');
  
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    // Initialize with current value using dynamic timezone info
    if (value) {
      const dynamicLabel = getTimezoneDisplayLabel(value);
      const timezoneInfo = getTimezoneInfo(value);
      setSelectedTimezone({
        ...timezoneInfo,
        label: dynamicLabel
      });
    }
  }, [value]);

  useEffect(() => {
    // Filter timezones based on search query using dynamic list
    const dynamicList = getDynamicTimezoneList();
    const filtered = dynamicList.filter(tz => 
      tz.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tz.country.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tz.city.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tz.region.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tz.value.toLowerCase().includes(searchQuery.toLowerCase())
    );
    setFilteredTimezones(filtered);
    setHighlightedIndex(-1);
  }, [searchQuery]);

  useEffect(() => {
    // Update current time display if enabled
    if (showCurrentTime && value) {
      const updateTime = () => {
        try {
          const now = new Date();
          const timeString = now.toLocaleString('en-US', {
            timeZone: value,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          });
          setCurrentTime(timeString);
        } catch (error) {
          setCurrentTime('');
        }
      };
      
      updateTime();
      const interval = setInterval(updateTime, 1000);
      return () => clearInterval(interval);
    }
  }, [showCurrentTime, value]);

  useEffect(() => {
    // Handle click outside to close dropdown
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleInputFocus = () => {
    setIsOpen(true);
    if (selectedTimezone) {
      setSearchQuery('');
    }
  };

  const handleInputChange = (e) => {
    setSearchQuery(e.target.value);
    setIsOpen(true);
  };

  const handleTimezoneSelect = (timezone) => {
    setSelectedTimezone(timezone);
    setSearchQuery('');
    setIsOpen(false);
    onChange?.(timezone.value);
  };

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        setIsOpen(true);
        return;
      }
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev < filteredTimezones.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredTimezones.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredTimezones[highlightedIndex]) {
          handleTimezoneSelect(filteredTimezones[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setSearchQuery('');
        inputRef.current?.blur();
        break;
      default:
        break;
    }
  };

  const handleDetectTimezone = () => {
    const browserTimezone = getBrowserTimezone();
    const dynamicLabel = getTimezoneDisplayLabel(browserTimezone);
    const timezoneInfo = getTimezoneInfo(browserTimezone);
    if (timezoneInfo) {
      handleTimezoneSelect({
        ...timezoneInfo,
        label: dynamicLabel
      });
    }
  };

  const clearSelection = () => {
    setSelectedTimezone(null);
    setSearchQuery('');
    onChange?.(DEFAULT_TIMEZONE);
    inputRef.current?.focus();
  };

  const displayValue = searchQuery || selectedTimezone?.label || '';

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Input Field */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Globe className="h-4 w-4 text-gray-400" />
        </div>
        
        <input
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={`w-full pl-10 pr-12 py-2 border rounded-lg focus:ring-2 focus:ring-custom-teal focus:border-transparent ${
            error 
              ? 'border-red-300 focus:ring-red-500' 
              : 'border-gray-300'
          } ${
            disabled 
              ? 'bg-gray-50 cursor-not-allowed' 
              : 'bg-white'
          }`}
        />
        
        {/* Clear/Search Icons */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          {selectedTimezone && !disabled && (
            <button
              type="button"
              onClick={clearSelection}
              className="mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-300"
              aria-label="Clear selected timezone"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          {isOpen && !selectedTimezone && (
            <Search className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </div>

      {/* Current Time Display */}
      {showCurrentTime && currentTime && selectedTimezone && (
        <div className="mt-1 text-xs text-gray-500 flex items-center">
          <Clock className="h-3 w-3 mr-1" />
          Current time: {currentTime}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}

      {/* Detect Button */}
      {showDetectButton && !disabled && (
        <button
          type="button"
          onClick={handleDetectTimezone}
          className="mt-2 flex items-center space-x-1 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
        >
          <Clock className="h-3 w-3" />
          <span>Detect my timezone</span>
        </button>
      )}

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-hidden">
          {filteredTimezones.length > 0 ? (
            <ul ref={listRef} className="py-1 overflow-y-auto max-h-60">
              {filteredTimezones.map((timezone, index) => (
                <li
                  key={timezone.value}
                  onClick={() => handleTimezoneSelect(timezone)}
                  className={`px-3 py-2 cursor-pointer transition-colors ${
                    index === highlightedIndex 
                      ? 'bg-blue-50 text-blue-900' 
                      : 'hover:bg-gray-50'
                  } ${
                    selectedTimezone?.value === timezone.value 
                      ? 'bg-blue-100 text-blue-900' 
                      : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {timezone.label}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {timezone.value} • {timezone.region}
                      </div>
                    </div>
                    {selectedTimezone?.value === timezone.value && (
                      <Check className="h-4 w-4 text-blue-600 flex-shrink-0 ml-2" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-8 text-center text-gray-500">
              <Globe className="h-8 w-8 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No timezones found</p>
              <p className="text-xs">Try searching for a city or country</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TimezoneSelector;