import React, { useState, useEffect, useRef } from 'react';
import { promptTemplates, getTemplatesByCategory, searchTemplates } from '../data/promptTemplates';

const TemplateSelector = ({ onSelect, onClose, isVisible, position = 'bottom' }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [filteredTemplates, setFilteredTemplates] = useState(promptTemplates);
  const [templatesByCategory, setTemplatesByCategory] = useState({});
  const [showSearch, setShowSearch] = useState(false);
  const searchInputRef = useRef(null);
  const modalRef = useRef(null);

  useEffect(() => {
    if (searchQuery.trim()) {
      const filtered = searchTemplates(searchQuery);
      setFilteredTemplates(filtered);
      setTemplatesByCategory({});
      setShowSearch(true);
    } else {
      setFilteredTemplates(promptTemplates);
      const categorized = getTemplatesByCategory();
      setTemplatesByCategory(categorized);
      setShowSearch(false);
    }
    setSelectedIndex(-1);
  }, [searchQuery]);

  useEffect(() => {
    if (isVisible && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isVisible]);

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (!isVisible) return;

    const templates = showSearch ? filteredTemplates : promptTemplates;
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < templates.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : templates.length - 1
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && templates[selectedIndex]) {
          handleTemplateSelect(templates[selectedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, selectedIndex, showSearch, filteredTemplates]);

  // Handle clicks outside the modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  const handleTemplateSelect = (template) => {
    onSelect(template.content);
    onClose();
    setSearchQuery('');
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div 
        ref={modalRef}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            选择提示词模板
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索模板..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {showSearch ? (
            // Search Results
            <div className="h-full overflow-y-auto">
              {filteredTemplates.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
                  没有找到匹配的模板
                </div>
              ) : (
                <div className="p-4 space-y-2">
                  {filteredTemplates.map((template, index) => (
                    <div
                      key={template.id}
                      onClick={() => handleTemplateSelect(template)}
                      className={`p-3 rounded-lg cursor-pointer border transition-all ${
                        index === selectedIndex
                          ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600'
                          : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">
                          {template.category}
                        </span>
                        <h3 className="font-medium text-gray-900 dark:text-white">
                          {template.title}
                        </h3>
                      </div>
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300 line-clamp-2">
                        {template.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            // Category View
            <div className="h-full overflow-y-auto">
              <div className="p-4 space-y-6">
                {Object.entries(templatesByCategory).map(([category, templates]) => (
                  <div key={category} className="space-y-3">
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 sticky top-0 bg-white dark:bg-gray-800 pb-2">
                      {category}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {templates.map((template) => (
                        <div
                          key={template.id}
                          onClick={() => handleTemplateSelect(template)}
                          className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors border border-gray-200 dark:border-gray-600"
                        >
                          <h4 className="font-medium text-gray-900 dark:text-white mb-2">
                            {template.title}
                          </h4>
                          <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-3">
                            {template.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
          <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
            <div className="flex items-center space-x-4">
              <span>↑↓ 导航</span>
              <span>Enter 选择</span>
              <span>Esc 关闭</span>
            </div>
            <div>
              共 {showSearch ? filteredTemplates.length : promptTemplates.length} 个模板
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateSelector;