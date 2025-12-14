import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import { Search } from 'lucide-react';

const UserSearch = ({ onSelect, placeholder = "Search users..." }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    const searchUsers = async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }

      setLoading(true);
      try {
        const response = await api.get(`/vacations/search-users?query=${encodeURIComponent(query)}`);
        setResults(response.data.users);
      } catch (error) {
        console.error('Error searching users:', error);
      } finally {
        setLoading(false);
      }
    };

    const timeoutId = setTimeout(searchUsers, 300);
    return () => clearTimeout(timeoutId);
  }, [query]);

  const handleSelect = (user) => {
    onSelect(user);
    setQuery('');
    setShowResults(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setShowResults(true)}
          placeholder={placeholder}
          className="w-full px-3 py-2 pl-10 border rounded-md"
        />
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
      </div>
      
      {showResults && (query.trim() || results.length > 0) && (
        <div className="absolute z-10 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
          {loading ? (
            <div className="p-2 text-center text-gray-500">Loading...</div>
          ) : results.length > 0 ? (
            <ul>
              {results.map(user => (
                <li
                  key={user._id}
                  onClick={() => handleSelect(user)}
                  className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                >
                  <div className="font-medium">{user.fullName}</div>
                  <div className="text-sm text-gray-500">{user.email}</div>
                  <div className="text-xs text-gray-400 capitalize">{user.role}</div>
                </li>
              ))}
            </ul>
          ) : query.trim() ? (
            <div className="p-2 text-center text-gray-500">No users found</div>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default UserSearch;