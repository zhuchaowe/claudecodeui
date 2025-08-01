import React, { useState } from 'react';

const CollapsibleJson = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check if content looks like JSON
  const isJsonLike = (str) => {
    if (typeof str !== 'string') return false;
    
    const trimmed = str.trim();
    // Check if it starts and ends with { } or [ ]
    const isObjectOrArray = (trimmed.startsWith('{') && trimmed.endsWith('}')) || 
                           (trimmed.startsWith('[') && trimmed.endsWith(']'));
    
    if (!isObjectOrArray) return false;
    
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  };

  // If it's not JSON-like, return the original content as a string
  if (!isJsonLike(content)) {
    // Ensure we always return a string for Markdown component
    return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  }

  // Format JSON for display
  const formatJson = (jsonString) => {
    try {
      const parsed = JSON.parse(jsonString.trim());
      return JSON.stringify(parsed, null, 2);
    } catch {
      return jsonString;
    }
  };

  const formattedJson = formatJson(content);

  return (
    <div className="border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 
                   flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300
                   transition-colors duration-200"
      >
        <span className="flex items-center gap-2">
          <svg 
            className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          JSON数据
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {isExpanded ? '收起' : '展开'}
        </span>
      </button>
      
      {isExpanded && (
        <div className="p-3 bg-gray-50 dark:bg-gray-900">
          <pre className="text-xs text-gray-700 dark:text-gray-300 overflow-auto max-h-96">
            <code>{formattedJson}</code>
          </pre>
        </div>
      )}
    </div>
  );
};

export default CollapsibleJson;